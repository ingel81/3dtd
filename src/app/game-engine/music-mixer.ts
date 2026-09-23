import { Audio, AudioListener } from 'three';

/** Steps of a duck's release (ms, wall clock) */
const DUCK_RELEASE_STEP_MS = 50;

/**
 * Represents one of two crossfade audio channels.
 * Each channel holds a Three.js non-positional Audio instance.
 */
interface AudioChannel {
  audio: Audio;
  /** The AudioBuffer currently loaded on this channel */
  buffer: AudioBuffer | null;
  /** Target volume for this channel (before master) */
  targetVolume: number;
  /** Current volume during fade (before master) */
  currentVolume: number;
  /** Timer for scheduling loop-crossfade before track end */
  loopTimer: ReturnType<typeof setTimeout> | null;
}

/** When to call back before a track ends, for a gapless loop by crossfade. */
export interface NearEndCallback {
  /** How long before the end of the track, in ms. */
  leadMs: number;
  /** Called only while the track is still on the active channel. */
  onNearEnd: () => void;
}

/**
 * Two Three.js Audio channels (A/B) for seamless crossfading: the active
 * channel plays, the idle one takes the next track and fades in while the
 * active one fades out. Volumes are track volume times the user volume.
 *
 * Knows nothing about phases or tracks; BackgroundMusicService decides what
 * plays and when.
 */
export class MusicMixer {
  private readonly channelA: AudioChannel;
  private readonly channelB: AudioChannel;
  private activeChannel: 'A' | 'B' = 'A';

  // Fade animation
  private fadeRafId: number | null = null;
  private fadeStartTime = 0;
  private fadeDuration = 0;
  private fadeOutChannel: AudioChannel | null = null;
  private fadeInChannel: AudioChannel | null = null;
  private fadeOutStartVol = 0;
  private fadeInTargetVol = 0;

  // User-controlled volume multiplier (0-1), applied on top of track + master volume
  private userVolume = 1.0;

  /** Pause dim (setDim) and duck (duck), multiplied onto every volume the channels get */
  private dim = 1;
  private ducked = 1;
  private duckTimer: ReturnType<typeof setTimeout> | null = null;
  private duckRelease: ReturnType<typeof setInterval> | null = null;

  /** A refused context resume is reported once, not on every crossfade and loop. */
  private resumeFailureLogged = false;

  constructor(private readonly listener: AudioListener) {
    this.channelA = this.createChannel();
    this.channelB = this.createChannel();
  }

  /**
   * Crossfade from the active channel to `buffer` on the idle one over
   * `durationMs`, the new track ending at `trackVolume`. Resumes a suspended
   * audio context before it plays; if the context refuses, the crossfade
   * goes ahead and the track sounds once the context runs. `nearEnd` is
   * called shortly before the new track ends, unless another crossfade or
   * stop() came first.
   */
  async crossfadeTo(
    buffer: AudioBuffer,
    trackVolume: number,
    durationMs: number,
    nearEnd: NearEndCallback,
  ): Promise<void> {
    const outChannel = this.getActiveChannel();
    const inChannel = this.getInactiveChannel();

    // Stop any pending loop timer on both channels
    this.clearLoopTimer(outChannel);
    this.clearLoopTimer(inChannel);

    // Cancel any ongoing fade
    this.cancelFade();

    // Prepare incoming channel
    this.stopChannel(inChannel);
    inChannel.buffer = buffer;
    inChannel.audio.setBuffer(buffer);
    // Looped natively as a fallback: the crossfade into itself (nearEnd) runs
    // on a timer that a hidden tab throttles, and a track that ended before it
    // fired left the music silent. Visible, the crossfade comes first and
    // stops this channel before it ever wraps.
    inChannel.audio.setLoop(true);

    inChannel.targetVolume = trackVolume;
    // fadeInTargetVol includes user volume for actual playback
    const effectiveVol = trackVolume * this.userVolume;
    inChannel.currentVolume = 0;
    inChannel.audio.setVolume(0);

    // Resume audio context if needed
    const ctx = this.listener.context;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (err) {
        // Go on: the fade above is cancelled and the old track's loop timer
        // cleared, so stopping here would leave neither channel looping. A
        // source started on a suspended context plays once it resumes.
        if (!this.resumeFailureLogged) {
          this.resumeFailureLogged = true;
          console.warn('[MusicMixer] Audio context did not resume, music waits for it:', err);
        }
      }
    }

    inChannel.audio.play();

    // Swap active
    this.activeChannel = this.activeChannel === 'A' ? 'B' : 'A';

    // Schedule the near-end callback for the new track
    this.scheduleNearEnd(inChannel, nearEnd);

    // Start fade animation
    this.fadeOutChannel = outChannel.audio.isPlaying ? outChannel : null;
    this.fadeInChannel = inChannel;
    this.fadeOutStartVol = outChannel.currentVolume;
    this.fadeInTargetVol = effectiveVol;
    this.fadeDuration = durationMs;
    this.fadeStartTime = performance.now();
    this.fadeRafId = requestAnimationFrame(this.fadeStep);
  }

  /**
   * Fade the active channel out over `durationMs` and start nothing new.
   * False when nothing is playing, so there is nothing to fade.
   */
  fadeOut(durationMs: number): boolean {
    const active = this.getActiveChannel();
    if (!active.audio.isPlaying) return false;

    this.cancelFade();
    this.fadeOutChannel = active;
    this.fadeInChannel = null;
    this.fadeOutStartVol = active.currentVolume;
    this.fadeInTargetVol = 0;
    this.fadeDuration = durationMs;
    this.fadeStartTime = performance.now();
    this.fadeRafId = requestAnimationFrame(this.fadeStep);
    return true;
  }

  /**
   * Share of the volume while the game is paused (1 when it runs). Applies
   * to the playing channels at once.
   */
  setDim(dim: number): void {
    this.dim = dim;
    this.applyGain();
  }

  /**
   * Duck under a big sound: to `factor` of the volume at once, held for
   * `holdMs`, then back to full over `releaseMs` (wall clock). A duck while
   * one runs takes the deeper factor and the later end.
   */
  duck(factor: number, holdMs: number, releaseMs: number): void {
    if (this.duckRelease !== null) {
      clearInterval(this.duckRelease);
      this.duckRelease = null;
    }
    if (this.duckTimer !== null) clearTimeout(this.duckTimer);
    this.ducked = Math.min(this.ducked, factor);
    this.applyGain();
    this.duckTimer = setTimeout(() => {
      this.duckTimer = null;
      const from = this.ducked;
      const steps = Math.max(1, Math.round(releaseMs / DUCK_RELEASE_STEP_MS));
      let step = 0;
      this.duckRelease = setInterval(() => {
        step++;
        this.ducked = from + (1 - from) * (step / steps);
        if (step >= steps) {
          this.ducked = 1;
          clearInterval(this.duckRelease!);
          this.duckRelease = null;
        }
        this.applyGain();
      }, DUCK_RELEASE_STEP_MS);
    }, holdMs);
  }

  /** Whether a track plays on the active channel. */
  get playing(): boolean {
    return this.getActiveChannel().audio.isPlaying;
  }

  /** Stop both channels immediately (no fade) and drop pending callbacks. */
  stop(): void {
    this.cancelFade();
    this.stopChannel(this.channelA);
    this.stopChannel(this.channelB);
  }

  /** Set the user volume (0-1). Updates playing channels and a running fade-in. */
  setUserVolume(vol: number): void {
    this.userVolume = vol;

    // Update fade target if a fade is in progress
    if (this.fadeInChannel) {
      this.fadeInTargetVol = this.fadeInChannel.targetVolume * this.userVolume;
    }

    // Update active channel volumes immediately
    const active = this.getActiveChannel();
    if (active.audio.isPlaying) {
      const v = active.targetVolume * this.userVolume;
      active.audio.setVolume(this.out(v));
      active.currentVolume = v;
    }
    const inactive = this.getInactiveChannel();
    if (inactive.audio.isPlaying) {
      const v = inactive.targetVolume * this.userVolume;
      inactive.audio.setVolume(this.out(v));
      inactive.currentVolume = v;
    }
  }

  /** Disconnect both channels from the audio graph. Call stop() first. */
  dispose(): void {
    if (this.duckTimer !== null) clearTimeout(this.duckTimer);
    if (this.duckRelease !== null) clearInterval(this.duckRelease);
    this.channelA.audio.disconnect();
    this.channelB.audio.disconnect();
  }

  private createChannel(): AudioChannel {
    const audio = new Audio(this.listener);
    return {
      audio,
      buffer: null,
      targetVolume: 0,
      currentVolume: 0,
      loopTimer: null,
    };
  }

  /** Arrow function to preserve `this` in rAF callback */
  private fadeStep = (now: number): void => {
    const elapsed = now - this.fadeStartTime;
    const t = Math.min(1, elapsed / this.fadeDuration);

    // Fade out
    if (this.fadeOutChannel) {
      const vol = this.fadeOutStartVol * (1 - t);
      this.fadeOutChannel.currentVolume = vol;
      this.fadeOutChannel.audio.setVolume(this.out(vol));
    }

    // Fade in
    if (this.fadeInChannel) {
      const vol = this.fadeInTargetVol * t;
      this.fadeInChannel.currentVolume = vol;
      this.fadeInChannel.audio.setVolume(this.out(vol));
    }

    if (t < 1) {
      this.fadeRafId = requestAnimationFrame(this.fadeStep);
    } else {
      // Fade complete
      if (this.fadeOutChannel) {
        this.stopChannel(this.fadeOutChannel);
      }
      if (this.fadeInChannel) {
        this.fadeInChannel.currentVolume = this.fadeInTargetVol;
        this.fadeInChannel.audio.setVolume(this.out(this.fadeInTargetVol));
      }
      this.fadeRafId = null;
      this.fadeOutChannel = null;
      this.fadeInChannel = null;
    }
  };

  /** A channel volume as it goes out: times the pause dim and the duck. */
  private out(volume: number): number {
    return volume * this.dim * this.ducked;
  }

  /** The dim or duck changed: the playing channels take it at their current volume. */
  private applyGain(): void {
    for (const channel of [this.channelA, this.channelB]) {
      if (channel.audio.isPlaying) channel.audio.setVolume(this.out(channel.currentVolume));
    }
  }

  private cancelFade(): void {
    if (this.fadeRafId !== null) {
      cancelAnimationFrame(this.fadeRafId);
      this.fadeRafId = null;
    }
    this.fadeOutChannel = null;
    this.fadeInChannel = null;
  }

  /**
   * Call back `leadMs` before the channel's track ends. This creates a
   * seamless loop without the gap of native `loop: true`.
   */
  private scheduleNearEnd(channel: AudioChannel, nearEnd: NearEndCallback): void {
    if (!channel.buffer) return;

    const durationMs = channel.buffer.duration * 1000;

    // Schedule the callback `leadMs` before the track ends
    const delay = Math.max(0, durationMs - nearEnd.leadMs);

    channel.loopTimer = setTimeout(() => {
      // Only if this channel is still active
      if (this.getActiveChannel() !== channel) return;
      nearEnd.onNearEnd();
    }, delay);
  }

  private clearLoopTimer(channel: AudioChannel): void {
    if (channel.loopTimer !== null) {
      clearTimeout(channel.loopTimer);
      channel.loopTimer = null;
    }
  }

  private getActiveChannel(): AudioChannel {
    return this.activeChannel === 'A' ? this.channelA : this.channelB;
  }

  private getInactiveChannel(): AudioChannel {
    return this.activeChannel === 'A' ? this.channelB : this.channelA;
  }

  private stopChannel(channel: AudioChannel): void {
    this.clearLoopTimer(channel);
    if (channel.audio.isPlaying) {
      channel.audio.stop();
    }
    channel.currentVolume = 0;
    channel.targetVolume = 0;
    channel.buffer = null;
  }
}
