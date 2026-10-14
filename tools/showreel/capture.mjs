// Screen capture and the sync of picture and sound for the showreel runner (run.mjs): which ddagrab output shows
// the browser, the recording with hevc_nvenc, the white flashes in the video and the clicks in the sound files,
// and the preview with the sound lined up. Needs ffmpeg on PATH with ddagrab and hevc_nvenc (Windows, NVIDIA).
import { spawn, execFileSync } from 'node:child_process';

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
