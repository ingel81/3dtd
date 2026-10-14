/**
 * The showreel hook (tools/showreel, README.md there): loaded by main.ts
 * only in a development build and only with `?showreel` in the address. It
 * taps the game's sound before the app starts, hides the real pointer and
 * the frame counters, and puts `__showreel` on the page for the runner:
 * scenes to play, the sync mark, the sound recording, the windows the page
 * asked to open.
 */
import type { Injector } from '@angular/core';
import { AudioRecording, installAudioTap } from './audio-tap';
import { Director, type Mark, type Scene } from './director';
import { EditorStage } from './editor-stage';
import { GameStage } from './game-stage';
import { Hands, nextFrame, waitUntil } from './hands';
import { ShowreelPointer } from './pointer';
import type { Stage } from './stage';

/** Frame counters and dev overlays out of the picture, the real pointer hidden */
const STYLE = `
html.showreel, html.showreel * { cursor: none !important; }
html.showreel app-info-overlay,
html.showreel .td-photo-bar,
html.showreel [data-test=fps],
html.showreel span:has(+ [data-test=fps]),
html.showreel [data-test=legend],
html.showreel [data-test=legend-open] { display: none !important; }
`;

export interface ShowreelApi {
  /** Resolves once the page's stage (game or editor) shows its map */
  ready(timeoutS?: number): Promise<string>;
  run(scene: Scene): Promise<Mark[]>;
  /** The sync mark: two white frames and a click into the recording; resolves with the flash's frame time */
  sync(): Promise<{ t: number; audioT: number }>;
  audio: {
    start(): Promise<{ mimeType: string; state: string; startedAt: number }>;
    stop(): Promise<number>;
    piece(offset: number, length: number): string;
    length(): number;
  };
  /** Addresses the page asked to open in another window (the editor's Test map), newest last */
  opened: string[];
  marks: Mark[];
}

/** Before the app starts: the sound tap and the page's look; the editor's tour and legend stay away */
export function installShowreelEarly(): void {
  installAudioTap();
  document.documentElement.classList.add('showreel');
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  try {
    localStorage.setItem('3dtd-editor-tour', 'done');
    localStorage.setItem('3dtd-editor-legend', 'hidden');
  } catch {
    // storage blocked: the tour shows, the script can still skip it
  }
}

/** Once the app runs: the director on `__showreel` */
export function startShowreel(injector: Injector): void {
  const opened: string[] = [];
  // The editor's Test map opens the game in another window; the runner opens it in this one instead
  window.open = ((url?: string | URL) => {
    if (url) opened.push(String(url));
    return null;
  }) as typeof window.open;

  let pointer: ShowreelPointer | null = null;
  const hands = (): Hands => new Hands((pointer ??= new ShowreelPointer()));
  let game: GameStage | null = null;
  let editor: EditorStage | null = null;
  const stage = (): Stage =>
    location.pathname.startsWith('/editor') ? (editor ??= new EditorStage()) : (game ??= new GameStage(injector, hands()));
  let director: Director | null = null;
  const directorOf = (): Director => (director ??= new Director(stage, hands()));
  let recording: AudioRecording | null = null;
  const marks: Mark[] = [];

  const api: ShowreelApi = {
    async ready(timeoutS = 120) {
      const s = stage();
      await waitUntil(() => s.ready(), timeoutS, `the ${s.kind} to show its map`);
      return s.kind;
    },
    async run(scene) {
      const run = await directorOf().run(scene);
      marks.push(...run);
      return run;
    },
    async sync() {
      const flash = document.createElement('div');
      Object.assign(flash.style, { position: 'fixed', inset: '0', background: '#fff', zIndex: '2147483647', pointerEvents: 'none' });
      // Appended in a frame's callback, the flash shows in that frame: the click goes with it
      const t = await nextFrame();
      document.body.append(flash);
      const audioT = recording?.click() ?? 0;
      marks.push({ t, kind: 'mark', scene: '', label: 'sync' });
      await nextFrame();
      await nextFrame();
      flash.remove();
      return { t, audioT };
    },
    audio: {
      async start() {
        recording = new AudioRecording();
        const started = await recording.start();
        return { ...started, startedAt: recording.startedAt };
      },
      stop: () => recording?.stop() ?? Promise.resolve(0),
      piece: (offset, length) => recording?.piece(offset, length) ?? '',
      length: () => recording?.base64Length ?? 0,
    },
    opened,
    marks,
  };
  (globalThis as Record<string, unknown>)['__showreel'] = api;
}
