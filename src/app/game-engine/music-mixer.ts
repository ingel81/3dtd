import { Audio, AudioListener } from 'three';

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

  constructor(private readonly listener: AudioListener) {
    this.channelA = this.createChannel();
    this.channelB = this.createChannel();
  }

  /**
   * Crossfade from the active channel to `buffer` on the idle one over
   * `durationMs`, the new track ending at `trackVolume`. Resumes a suspended
   * audio context before it plays. `nearEnd` is called shortly before the
   * new track ends, unless another crossfade or stop() came first.
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
    inChannel.audio.setLoop(false);

    inChannel.targetVolume = trackVolume;
    // fadeInTargetVol includes user volume for actual playback
    const effectiveVol = trackVolume * this.userVolume;
    inChannel.currentVolume = 0;
    inChannel.audio.setVolume(0);

    // Resume audio context if needed
    const ctx = this.listener.context;
    if (ctx.state === 'suspended') {
      await ctx.resume();
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
      active.audio.setVolume(v);
      active.currentVolume = v;
    }
    const inactive = this.getInactiveChannel();
    if (inactive.audio.isPlaying) {
      const v = inactive.targetVolume * this.userVolume;
      inactive.audio.setVolume(v);
      inactive.currentVolume = v;
    }
  }

  /** Disconnect both channels from the audio graph. Call stop() first. */
  dispose(): void {
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
      this.fadeOutChannel.audio.setVolume(vol);
    }

    // Fade in
    if (this.fadeInChannel) {
      const vol = this.fadeInTargetVol * t;
      this.fadeInChannel.currentVolume = vol;
      this.fadeInChannel.audio.setVolume(vol);
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
        this.fadeInChannel.audio.setVolume(this.fadeInTargetVol);
      }
      this.fadeRafId = null;
      this.fadeOutChannel = null;
      this.fadeInChannel = null;
    }
  };

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
