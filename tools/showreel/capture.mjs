import { spawn as spawnProcess } from 'node:child_process';
// Screen capture and the sync of picture and sound for the showreel runner (run.mjs): which ddagrab output shows
// the browser, the recording with hevc_nvenc, the white flashes in the video and the clicks in the sound files,
// and the preview with the sound lined up. Needs ffmpeg on PATH with ddagrab and hevc_nvenc (Windows, NVIDIA).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WINDOW_PS1 = join(dirname(fileURLToPath(import.meta.url)), 'window.ps1');

/** The displays as Windows has them (physical pixels), primary first */
export function displays() {
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms;',
    "Add-Type 'using System;using System.Runtime.InteropServices;public class DpiShowreel{[DllImport(\"user32.dll\")]public static extern bool SetProcessDPIAware();}';",
    '[DpiShowreel]::SetProcessDPIAware() | Out-Null;',
    '[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { "$($_.DeviceName)|$($_.Bounds.X)|$($_.Bounds.Y)|$($_.Bounds.Width)|$($_.Bounds.Height)|$($_.Primary)" }',
  ].join(' ');
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  return out
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [name, x, y, width, height, primary] = line.split('|');
      return { name: name.replace(/^\\\\\.\\/, ''), x: +x, y: +y, width: +width, height: +height, primary: primary === 'True' };
    })
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

/**
 * The showreel window to the front and topmost (window.ps1): found by a title only it carries; returns its
 * handle, 0 when no such window shows. `release(handle)` takes topmost away again.
 */
export function raiseWindow(title) {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WINDOW_PS1, '-Title', title], { encoding: 'utf8' });
  return Number(out.trim().split(/\s+/).pop() || 0);
}

/** The window `handle` to the front again (its title changes with each page) */
export function raiseHandle(handle) {
  if (!handle) return;
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WINDOW_PS1, '-Handle', String(handle)]);
}

/** The colour on the screen at x, y (desktop pixels) by GDI, [r, g, b]; works while ddagrab records */
export function screenColour(x, y) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WINDOW_PS1, '-ProbeX', String(x), '-ProbeY', String(y)], { encoding: 'utf8', timeout: 10_000 });
    const rgb = out.trim().split(',').map(Number);
    return rgb.length === 3 && rgb.every((v) => Number.isFinite(v)) ? rgb : null;
  } catch {
    return null;
  }
}

/**
 * The displays kept on while the run records: with nobody at the machine Windows turned the monitors off and
 * the desktop duplication then delivered no new frames (takes 4 to 7 froze on a still). A PowerShell process
 * asks for ES_DISPLAY_REQUIRED every 20 s until it is killed; the power settings stay as they are
 */
export function keepDisplayOn() {
  const script = `Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'; while ($true) { [W.P]::SetThreadExecutionState(0x80000003) | Out-Null; Start-Sleep 20 }`;
  const child = spawnProcess('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
  return () => child.kill();
}

export function releaseWindow(handle) {
  if (!handle) return;
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WINDOW_PS1, '-Release', '-Handle', String(handle)]);
}

/** The mean colour of one frame of a ddagrab output, [r, g, b], null where the output does not exist */
export function outputColour(index) {
  try {
    const raw = execFileSync(
      'ffmpeg',
      ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', `ddagrab=output_idx=${index}:framerate=10:draw_mouse=0`, '-frames:v', '1',
        '-vf', 'hwdownload,format=bgra,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 },
    );
    return raw.length >= 3 ? [raw[0], raw[1], raw[2]] : null;
  } catch {
    return null;
  }
}

/**
 * The output that shows `colour` now (the page shows a solid test colour while this runs): one frame of each
 * output, the closest mean colour wins. Returns its index and every output's colour for the log.
 */
export function findOutput(colour, max = 8) {
  const seen = [];
  for (let i = 0; i < max; i++) {
    const c = outputColour(i);
    if (!c) break;
    seen.push({ index: i, colour: c, distance: Math.hypot(c[0] - colour[0], c[1] - colour[1], c[2] - colour[2]) });
  }
  const best = [...seen].sort((a, b) => a.distance - b.distance)[0];
  return { index: best && best.distance < 60 ? best.index : null, seen };
}

/**
 * Start recording output `index` to `file` (Matroska, survives a crash). Resolves once frames come; `stop()`
 * ends it cleanly ('q' on stdin) and resolves when ffmpeg exits.
 */
export function startCapture(index, file, { cq = 18, fps = 60, chroma = '420' } = {}) {
  const args = [
    '-hide_banner', '-y', '-stats_period', '0.5',
    '-f', 'lavfi', '-i', `ddagrab=output_idx=${index}:framerate=${fps}:draw_mouse=0`,
    '-c:v', 'hevc_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', String(cq), '-b:v', '0',
    '-g', String(fps * 2), '-bf', '0',
    ...(chroma === '444' ? ['-profile:v', 'rext'] : []),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    file,
  ];
  const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let log = '';
  let startedAt = 0;
  const started = new Promise((resolve, reject) => {
    proc.stderr.on('data', (d) => {
      log += d.toString();
      if (log.length > 200_000) log = log.slice(-100_000);
      if (!startedAt && /frame=\s*\d+/.test(log)) {
        startedAt = Date.now();
        resolve(startedAt);
      }
    });
    proc.on('exit', (code) => {
      if (!startedAt) reject(new Error(`ffmpeg ended before recording (${code}):\n${log.slice(-2000)}`));
    });
  });
  const exited = new Promise((resolve) => proc.on('exit', (code) => resolve(code)));
  return {
    started,
    /** Wall clock (Date.now) of the first progress line, about when frame 0 was taken */
    get startedAt() {
      return startedAt;
    },
    async stop() {
      if (proc.exitCode === null) proc.stdin.write('q');
      const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 30_000))]);
      if (code === 'timeout') proc.kill();
      return { code, log: log.slice(-3000) };
    },
  };
}

/** A test colour the page shows while the runner looks for its display */
export const PROBE_COLOUR = [255, 0, 255];

/** The display a run records on: `name` (DISPLAY2), else the primary */
export function chooseDisplay(name = '') {
  const all = displays();
  const d = name ? all.find((x) => x.name === name) : all[0];
  if (!d) throw new Error(`no display ${name}; have ${all.map((x) => x.name).join(', ')}`);
  return d;
}

/**
 * The showreel window on `display` found and recorded to `file`: the page shows a test colour under a title only
 * it carries, the window is raised (Windows' foreground lock opens a new window behind the user's) and stays
 * topmost, ddagrab's output showing the colour is recorded. `onScreen()` checks later that the page still reaches
 * the display; `release()` lets the window go.
 */
export async function recordDisplay(page, display, file, { stamp, outputIdx = '', cq = 18, chroma = '420' }) {
  const token = `3DTD showreel ${stamp}`;
  await page.setContent(`<title>${token}</title><body style="margin:0;background:rgb(${PROBE_COLOUR.join(',')});cursor:none"></body>`);
  await page.waitForTimeout(1500);
  let index = outputIdx;
  let raised = 0;
  for (let attempt = 1; attempt <= 4; attempt++) {
    raised = raiseWindow(token) || raised;
    console.log(`window ${raised ? `raised (handle ${raised})` : 'not found'}, try ${attempt}`);
    await page.waitForTimeout(1200);
    if (index !== '') break;
    const found = findOutput(PROBE_COLOUR);
    console.log(`outputs: ${found.seen.map((s) => `${s.index}=rgb(${s.colour.join(',')})`).join('  ')}`);
    if (found.index !== null) {
      index = found.index;
      break;
    }
  }
  if (index === '') throw new Error('no ddagrab output shows the window; pass --output-idx');
  console.log(`recording ddagrab output ${index}`);
  const capture = startCapture(Number(index), file, { cq, chroma });
  await capture.started;
  return {
    capture,
    /**
     * The page really reaches the display: take 4 froze on the last frame of a page for ten minutes once the
     * window had lost the foreground (the user typing elsewhere), the pages played on unseen. The page shows the
     * test colour for a moment, GDI reads the screen (ddagrab can't be opened twice); without it the window is
     * raised again by its handle, and after three tries the run stops instead of recording a still
     */
    async onScreen() {
      const x = display.x + 400;
      const y = display.y + 400;
      await page.evaluate((col) => {
        const d = document.createElement('div');
        d.id = 'sr-probe';
        d.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:rgb(${col.join(',')})`;
        document.documentElement.append(d);
      }, PROBE_COLOUR);
      try {
        for (let attempt = 1; attempt <= 3; attempt++) {
          await page.waitForTimeout(250);
          const seen = screenColour(x, y);
          if (seen && seen.every((v, i) => Math.abs(v - PROBE_COLOUR[i]) < 40)) return;
          console.log(`  the page is not on the display (saw ${seen ? seen.join(',') : 'nothing'}), raising the window, try ${attempt}`);
          raiseHandle(raised);
          await page.waitForTimeout(800);
        }
        throw new Error('the showreel window does not reach the display');
      } finally {
        await page.evaluate(() => document.getElementById('sr-probe')?.remove()).catch(() => undefined);
      }
    },
    release() {
      try {
        releaseWindow(raised);
      } catch {
        // the window may be gone already
      }
    },
  };
}

/**
 * A headless page recorded through Chrome's screencast (DevTools Page.startScreencast) to `file` at `fps`,
 * the same interface as startCapture. The page sends a frame whenever it draws a new one; each lands in its slot
 * of the fixed frame rate by its swap time, and the slots between repeat the frame before, as a display capture
 * repeats a frame the page did not draw. So a stall of the page shows as a held frame in the video, and the
 * take's check finds it. The frames' size is the viewport's times the pixel ratio.
 */
export async function startScreencast(page, file, { fps = 60, cq = 20, quality = 92 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const proc = spawn('ffmpeg', [
    '-hide_banner', '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'hevc_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', String(cq), '-b:v', '0', '-g', String(fps * 2), '-bf', '0',
    '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', file,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let log = '';
  proc.stderr.on('data', (d) => (log = (log + d.toString()).slice(-4000)));
  const exited = new Promise((resolve) => proc.on('exit', (code) => resolve(code)));
  let first = null;
  let written = 0;
  let last = null;
  let frames = 0;
  let resolveStarted;
  const started = new Promise((r) => (resolveStarted = r));
  const fill = (slot) => {
    while (last && written < slot) {
      proc.stdin.write(last);
      written++;
    }
  };
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
    const at = metadata.timestamp ?? Date.now() / 1000;
    if (first === null) {
      first = at;
      resolveStarted(first * 1000);
    }
    fill(Math.round((at - first) * fps));
    last = Buffer.from(data, 'base64');
    frames++;
  });
  const view = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality, everyNthFrame: 1,
    maxWidth: Math.round(view.w * view.dpr), maxHeight: Math.round(view.h * view.dpr),
  });
  return {
    started,
    /** Wall clock (ms) of frame 0: the first frame's swap time */
    get startedAt() {
      return first === null ? 0 : first * 1000;
    },
    /** Frames the page sent (the rest of the video repeats them) */
    get frames() {
      return frames;
    },
    async stop() {
      await cdp.send('Page.stopScreencast').catch(() => undefined);
      // The last frame held up to now, then the end of the file
      if (first !== null) fill(Math.round((Date.now() / 1000 - first) * fps) + 1);
      proc.stdin.end();
      const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 60_000))]);
      if (code === 'timeout') proc.kill();
      await cdp.detach().catch(() => undefined);
      return { code, log };
    },
  };
}

/**
 * The white flashes in a video: runs of frames whose mean brightness is near white, as [{ start, frames }]
 * (seconds of the first white frame). Decodes the whole file small.
 */
export function detectFlashes(file, threshold = 225) {
  const out = execFileSync(
    'ffmpeg',
    ['-hide_banner', '-v', 'error', '-hwaccel', 'auto', '-i', file, '-an',
      '-vf', 'scale=64:36,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 30 },
  );
  const flashes = [];
  let time = 0;
  let run = null;
  for (const line of out.split(/\r?\n/)) {
    const pts = /pts_time:([\d.]+)/.exec(line);
    if (pts) {
      time = Number(pts[1]);
      continue;
    }
    const y = /YAVG=([\d.]+)/.exec(line);
    if (!y) continue;
    if (Number(y[1]) >= threshold) {
      if (run && time - run.last < 0.1) {
        run.frames++;
        run.last = time;
      } else {
        run = { start: time, last: time, frames: 1 };
        flashes.push(run);
      }
    }
  }
  return flashes.map(({ start, frames }) => ({ start, frames }));
}

/** Seconds into a sound file of its first sample louder than `threshold` (the sync click), null without one */
export function detectClick(file, threshold = 0.5) {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], {
    maxBuffer: 1 << 30,
  });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > threshold) return i / 48000;
  return null;
}

/**
 * A recorder's WebM as FLAC beside it: Chrome's MediaRecorder writes no duration into the file and ffmpeg's
 * Opus decoder complains about one packet header ("Error parsing Opus packet header"), the sound itself decodes
 * whole. The FLAC has its length and is what the alignment and the mix read.
 */
export function toFlac(file) {
  const flac = file.replace(/\.webm$/, '.flac');
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'fatal', '-y', '-i', file, '-c:a', 'flac', flac]);
  return flac;
}

/** Length of a media file in seconds */
export function duration(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Number(out.trim());
}

/**
 * The sound files laid onto the video's time line: each at `offset` seconds (where its first sample falls in
 * the video). Writes the whole sound as WAV and a preview MP4 (video copied, AAC).
 */
export function mux(video, sounds, wavOut, mp4Out) {
  const inputs = sounds.flatMap((s) => ['-i', s.file]);
  const parts = sounds.map((s, i) => {
    const ms = Math.max(0, Math.round(s.offset * 1000));
    // A file that starts before the video does: its head is cut
    const trim = s.offset < 0 ? `atrim=start=${(-s.offset).toFixed(3)},asetpts=PTS-STARTPTS,` : '';
    return `[${i + 1}:a]${trim}aresample=48000,adelay=${ms}:all=1[s${i}]`;
  });
  const mix = sounds.length > 1
    ? `${sounds.map((_, i) => `[s${i}]`).join('')}amix=inputs=${sounds.length}:normalize=0:duration=longest[a]`
    : '[s0]anull[a]';
  const graph = [...parts, mix].join(';');
  const length = duration(video).toFixed(3);
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', video, ...inputs, '-filter_complex', graph, '-map', '[a]', '-t', length,
    '-c:a', 'pcm_s16le', wavOut], { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', video, '-i', wavOut, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-tag:v', 'hvc1', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', mp4Out], { stdio: 'inherit' });
}

/**
 * Picture and sound lined up for a run's folder: each page's flash in the video, its click in its sound file.
 * Reads run.json; without one (a run from before it) flashes and sound files pair up in order. Writes marks.json
 * (every mark with `video`, seconds into video.mkv), sound.wav and preview.mp4; returns what it wrote to marks.json.
 */
export function alignRun(out) {
  const video = join(out, 'video.mkv');
  if (!existsSync(video)) throw new Error(`no video.mkv in ${out}`);
  const state = existsSync(join(out, 'run.json'))
    ? JSON.parse(readFileSync(join(out, 'run.json'), 'utf8'))
    : { captureStartedAt: null, pages: [], marks: [], problems: [] };
  if (!state.pages.length) {
    state.pages = readdirSync(out)
      .filter((f) => /^sound-\d+\.webm$/.test(f))
      .sort()
      .map((f) => {
        const flac = join(out, f.replace('.webm', '.flac'));
        return { file: existsSync(flac) ? flac : toFlac(join(out, f)) };
      });
  }
  console.log(`finding the flashes in the video (${state.pages.length} pages)`);
  // The sync flash is white for 120 ms, 7 frames of the 60 fps capture; a page's white before it loads (a
  // navigation, Chrome's first blank page) is mostly a frame or two, so runs of 4 to 12 frames count, with the
  // run's clock to pick by up to 40
  // On an intro page the flash falls into the map's load, where frames stall: it stays white up to some 25 frames
  const flashes = detectFlashes(video).filter((f) => f.frames >= 4 && f.frames <= (state.captureStartedAt ? 40 : 12));
  console.log(`  flashes at ${flashes.map((f) => f.start.toFixed(2)).join(', ')} s`);
  // Without the run's clock, the last flashes pair with the pages in order (an early white page is no page)
  const ordered = flashes.slice(-state.pages.length);
  const lined = state.pages.map((s, i) => {
    const expected = s.syncWall && state.captureStartedAt ? (s.syncWall - state.captureStartedAt) / 1000 : null;
    const flash =
      expected === null
        ? ordered[i]
        : flashes.map((f) => ({ ...f, off: Math.abs(f.start - expected) })).sort((a, b) => a.off - b.off).find((f) => f.off <= 5);
    const click = detectClick(s.file);
    if (!flash) console.log(`  page ${i}: no flash${expected === null ? '' : ` near ${expected.toFixed(2)} s`}, sound placed by the clock`);
    if (click === null) console.log(`  page ${i}: no click in ${s.file}, sound placed by the clock`);
    const flashAt = flash ? flash.start : (expected ?? 0);
    // Where the sound file starts on the video's time line: the click lies `click` seconds into it
    const clickAt = click ?? (s.sync && s.audio ? (s.sync.t - s.audio.startedAt) / 1000 : 0);
    return { ...s, flashAt, offset: flashAt - clickAt };
  });
  const timed = state.marks.length
    ? state.marks.map((m) => {
        const s = lined[m.segment];
        return { ...m, video: s?.sync ? +(s.flashAt + (m.t - s.sync.t) / 1000).toFixed(3) : null };
      })
    : lined.map((s, i) => ({ kind: 'scene-start', label: `page ${i}`, video: +s.flashAt.toFixed(3) }));
  writeFileSync(join(out, 'marks.json'), JSON.stringify({ flashes, pages: lined, marks: timed, problems: state.problems }, null, 2));
  console.log('mixing the preview');
  mux(video, lined.map((s) => ({ file: s.file, offset: s.offset })), join(out, 'sound.wav'), join(out, 'preview.mp4'));
  for (const m of timed.filter((x) => x.kind === 'scene-start' || x.kind === 'step')) {
    console.log(`  ${String(m.video?.toFixed(2)).padStart(8)} s  ${m.kind === 'step' ? '  ' : ''}${m.label}`);
  }
  console.log(`done: ${join(out, 'preview.mp4')}, marks.json, sound.wav, video.mkv`);
  return { flashes, pages: lined, marks: timed };
}
