/**
 * The game's sound for the showreel: whatever any node sends to the
 * speakers also goes to a MediaStream, which a MediaRecorder writes as
 * Opus/WebM. Installed before the app starts, since the game wires its
 * master bus (SpatialAudioManager: listener → pre-gain → limiter →
 * destination) once. The sync mark puts a loud click into the recording
 * only (not the speakers) in the frame the page flashes white; the runner
 * lines both up.
 */
import { AudioContext as ThreeAudioContext } from 'three';

const taps = new WeakMap<BaseAudioContext, MediaStreamAudioDestinationNode>();

function tapOf(ctx: BaseAudioContext): MediaStreamAudioDestinationNode | null {
  if (!(ctx instanceof AudioContext)) return null;
  let tap = taps.get(ctx);
  if (!tap) {
    tap = ctx.createMediaStreamDestination();
    tap.channelCount = 2;
    taps.set(ctx, tap);
  }
  return tap;
}

let installed = false;

/** Every connection to a context's speakers also feeds that context's tap */
export function installAudioTap(): void {
  if (installed) return;
  installed = true;
  const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
  AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
    const result = connect.apply(this, args);
    const [destination, output] = args;
    if (destination instanceof AudioDestinationNode) {
      const tap = tapOf(this.context);
      if (tap) connect.call(this, tap, output ?? 0);
    }
    return result;
  } as AudioNode['connect'];
}

/** One recording of the page's sound, from start() to stop() */
export class AudioRecording {
  private recorder: MediaRecorder | null = null;
  private readonly chunks: Blob[] = [];
  private data: string | null = null;
  readonly ctx = ThreeAudioContext.getContext() as unknown as AudioContext;
  /** performance.now() when the recorder started */
  startedAt = 0;

  async start(): Promise<{ mimeType: string; state: AudioContextState }> {
    const ctx = this.ctx;
    if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
    const tap = tapOf(ctx)!;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(tap.stream, { mimeType, audioBitsPerSecond: 256_000 });
    recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    const started = new Promise<void>((done) => (recorder.onstart = () => done()));
    recorder.start(1000);
    await started;
    this.startedAt = performance.now();
    this.recorder = recorder;
    return { mimeType, state: ctx.state };
  }

  /** A short loud tone (full scale, 40 ms at 1 kHz) into the recording only */
  click(): number {
    const ctx = this.ctx;
    const tap = tapOf(ctx)!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1000;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.002);
    gain.gain.setValueAtTime(1, t + 0.038);
    gain.gain.linearRampToValueAtTime(0, t + 0.04);
    osc.connect(gain);
    gain.connect(tap);
    osc.start(t);
    osc.stop(t + 0.05);
    osc.onended = () => gain.disconnect();
    return t;
  }

  /** Stop and keep the file as base64; resolves with its size in bytes */
  async stop(): Promise<number> {
    const recorder = this.recorder;
    if (!recorder) return 0;
    this.recorder = null;
    const stopped = new Promise<void>((done) => (recorder.onstop = () => done()));
    recorder.stop();
    await stopped;
    const blob = new Blob(this.chunks, { type: recorder.mimeType });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    this.data = btoa(text);
    return bytes.length;
  }

  /** A piece of the stopped file's base64, `length` characters from `offset`; '' past the end */
  piece(offset: number, length: number): string {
    return this.data ? this.data.slice(offset, offset + length) : '';
  }

  get base64Length(): number {
    return this.data?.length ?? 0;
  }
}
