// The automatic check of a take (take.mjs runs it, `run.mjs --check <take>` again), before anyone watches it:
// stutter and frozen stretches in the picture, black and white frames, silence, level jumps and clipping in the
// sound, the camera under water or in the ground from its log; a contact sheet (one frame a second and one after
// every labelled step, sheets.py). Writes check.json and sheet.jpg into the take; returns the verdict.
//
// Picture: the video decoded small and grey; a frame that differs from the one before by less than HOLD_DIFF
// (mean of 0-255) repeats it, as ffmpeg's mpdecimate would drop it. A run of repeats is a held picture: a stutter
// when it lasts STUTTER_S or more while the camera moves (its log) or between moving frames, frozen when it lasts
// FROZEN_S while the camera moves. The head and tail stills and the sync flash are left out.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { HERE } from './browser.mjs';

/** Mean difference (0-255) under which a frame repeats the one before */
const HOLD_DIFF = 0.3;
/** A held picture this long is a stutter, s (eight frames at 60 fps) */
const STUTTER_S = 0.12;
/** A held picture this long with the camera moving is a frozen stretch, s */
const FROZEN_S = 1;
/** Without a moving camera a picture held this long is noted (an idle map holds still on purpose), s */
const STILL_NOTE_S = 6;
/** Short stutters a take may have and stay ok; one held this long while the camera moves is red on its own, s */
const MAX_STUTTERS = 2;
const HITCH_S = 0.25;
/** Mean luma (limited range) of a black and of a white frame */
const BLACK_Y = 20;
const WHITE_Y = 225;
/** Sound: silence below, jumps over this many dB in one window, clipping at */
const SILENCE_DB = -60;
const SILENCE_S = 2;
const JUMP_DB = 30;
const CLIP = 0.999;
/** The analysis picture, small */
const AW = 160;
const AH = 90;

const fpsOf = (file) => {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim();
  const [a, b] = out.split('/').map(Number);
  return b ? a / b : a;
};

/** Per frame: mean luma and mean difference to the frame before */
function frameStats(file) {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-an', '-vf', `scale=${AW}:${AH}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 2 ** 31 });
  const n = AW * AH;
  const count = Math.floor(raw.length / n);
  const luma = new Float32Array(count);
  const diff = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    let sum = 0;
    let d = 0;
    const o = f * n;
    for (let i = 0; i < n; i++) {
      const v = raw[o + i];
      sum += v;
      if (f) d += Math.abs(v - raw[o - n + i]);
    }
    luma[f] = sum / n;
    diff[f] = f ? d / n : 255;
  }
  return { luma, diff, count };
}

/** RMS levels in dBFS per `win` seconds of a sound file (mono, 48 kHz), and the clipped samples */
function soundStats(file, win = 0.05) {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 2 ** 31 });
  const s = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
  const step = Math.round(48000 * win);
  const levels = [];
  for (let i = 0; i + step <= s.length; i += step) {
    let e = 0;
    for (let k = i; k < i + step; k++) e += s[k] * s[k];
    levels.push(10 * Math.log10(e / step + 1e-12));
  }
  const clipped = [];
  for (let i = 0; i < s.length; i++) if (Math.abs(s[i]) >= CLIP) clipped.push(i / 48000);
  return { levels, win, clipped };
}

/** Runs of indices where `test(i)` holds, as [first, last] */
function runs(count, test) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= count; i++) {
    if (i < count && test(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

const fmt = (t) => `${t.toFixed(2)} s`;

/** The take's line in takes/<scene>/index.json, replacing an earlier line of the same take */
export function indexLine(sceneDir, line) {
  const file = join(sceneDir, 'index.json');
  const index = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { takes: [] };
  const before = index.takes.find((t) => t.id === line.id);
  // A take marked accepted by hand stays so
  const kept = before?.accepted ? { accepted: true } : {};
  index.takes = [...index.takes.filter((t) => t.id !== line.id), { ...line, ...kept }].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(file, JSON.stringify(index, null, 2));
}

/** A recorded take checked (again) and its line in the scene's index.json written */
export function checkAndIndex(dir) {
  const verdict = checkTake(dir);
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  indexLine(dirname(dir), {
    id: basename(dir),
    at: meta.at,
    status: verdict.status,
    reasons: verdict.reasons,
    warnings: verdict.warnings,
    duration: meta.duration,
    app: meta.app?.commit ?? null,
    fixture: meta.fixture?.sha256?.slice(0, 12) ?? null,
  });
  return verdict;
}

export function checkTake(dir) {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const marks = JSON.parse(readFileSync(join(dir, 'marks.json'), 'utf8'));
  const video = join(dir, 'video.mkv');
  const reasons = [];
  const warnings = [];
  const at = (label, kind = 'mark') => marks.marks.find((m) => m.kind === kind && (kind !== 'mark' || m.label === label))?.video ?? null;
  const flashAt = marks.pages[0]?.flashAt ?? 0;
  const sceneStart = at(null, 'scene-start') ?? flashAt;
  const sceneEnd = at(null, 'scene-end') ?? meta.duration;
  const tail = at('end') ?? meta.duration;
  // The body: after the flash (120 ms and a margin) to the end of the tail still
  const from = flashAt + 0.25;
  const to = tail;
  // A fade the scene asks for (a step labelled fade...): black from there is meant
  const fadeAt = marks.marks.filter((m) => /^fade/.test(m.label ?? '') && m.video !== null).map((m) => m.video).sort((a, b) => a - b)[0] ?? Infinity;

  // --- picture
  const fps = fpsOf(video);
  const { luma, diff, count } = frameStats(video);
  const time = (f) => f / fps;
  const cam = (meta.camera?.frames ?? []).filter((r) => r[0] !== null);
  const rows = existsSync(join(dir, 'camera.json')) ? JSON.parse(readFileSync(join(dir, 'camera.json'), 'utf8')) : [];
  /** How far the camera (eye and look) moved between two video times, m */
  const moved = (t0, t1) => {
    const inside = rows.filter((r) => r[0] >= t0 && r[0] <= t1);
    if (inside.length < 2) return 0;
    const a = inside[0];
    const b = inside[inside.length - 1];
    return Math.max(Math.hypot(b[1] - a[1], b[2] - a[2], b[3] - a[3]), Math.hypot(b[6] - a[6], b[7] - a[7], b[8] - a[8]));
  };
  const changing = (f0, f1) => {
    let n = 0;
    let all = 0;
    for (let f = Math.max(1, f0); f <= Math.min(count - 1, f1); f++, all++) if (diff[f] >= HOLD_DIFF) n++;
    return all ? n / all : 0;
  };
  const stutters = [];
  const frozen = [];
  const stills = [];
  for (const [a, b] of runs(count, (f) => f > 0 && diff[f] < HOLD_DIFF)) {
    // The held picture shows from the frame before the run to its last frame
    const t0 = time(a - 1);
    const t1 = time(b + 1);
    const held = t1 - t0;
    if (t0 < from || t1 > sceneEnd + 0.05) continue;
    // Inside the held stretch only: a camera that starts to move ends the hold a frame later, not during it
    const camMoves = moved(t0 + 2 / fps, t1 - 2 / fps) > 0.05;
    const between = changing(a - 10, a - 1) >= 0.5 && changing(b + 1, b + 10) >= 0.5;
    if (held >= FROZEN_S && camMoves) frozen.push({ at: +t0.toFixed(3), held: +held.toFixed(3) });
    else if (held >= STUTTER_S && (camMoves || (between && held < FROZEN_S))) stutters.push({ at: +t0.toFixed(3), held: +held.toFixed(3), camera: camMoves });
    else if (held >= STILL_NOTE_S) stills.push({ at: +t0.toFixed(3), held: +held.toFixed(3) });
  }
  const dark = [];
  const bright = [];
  for (const [a, b] of runs(count, (f) => time(f) >= from && time(f) <= to && time(f) < fadeAt && luma[f] < BLACK_Y)) dark.push({ at: +time(a).toFixed(3), frames: b - a + 1 });
  for (const [a, b] of runs(count, (f) => time(f) >= from && time(f) <= to && luma[f] > WHITE_Y)) bright.push({ at: +time(a).toFixed(3), frames: b - a + 1 });
  const hitches = stutters.filter((s) => s.camera && s.held >= HITCH_S);
  if (hitches.length) reasons.push(`hitch while the camera moves: ${hitches.map((s) => `${Math.round(s.held * 1000)} ms at ${fmt(s.at)}`).join(', ')}`);
  else if (stutters.length > MAX_STUTTERS) reasons.push(`${stutters.length} stutters (held ${stutters.slice(0, 4).map((s) => `${Math.round(s.held * 1000)} ms at ${fmt(s.at)}`).join(', ')}${stutters.length > 4 ? ', ...' : ''})`);
  else if (stutters.length) warnings.push(`${stutters.length} stutter${stutters.length > 1 ? 's' : ''} (${stutters.map((s) => `${Math.round(s.held * 1000)} ms at ${fmt(s.at)}`).join(', ')})`);
  if (frozen.length) reasons.push(`frozen while the camera moves: ${frozen.map((s) => `${s.held.toFixed(1)} s at ${fmt(s.at)}`).join(', ')}`);
  if (stills.length) warnings.push(`picture still ${stills.map((s) => `${s.held.toFixed(1)} s at ${fmt(s.at)}`).join(', ')} (camera still too)`);
  if (dark.length) reasons.push(`black frames at ${dark.slice(0, 4).map((d) => `${fmt(d.at)} (${d.frames})`).join(', ')}`);
  if (bright.length) reasons.push(`white frames at ${bright.slice(0, 4).map((d) => `${fmt(d.at)} (${d.frames})`).join(', ')}`);

  // --- sound (on the video's time line)
  const kind = meta.state?.kind ?? meta.start?.kind;
  const expectSound = meta.environment?.sound ?? kind === 'game';
  const wav = join(dir, 'sound.wav');
  let sound = null;
  if (existsSync(wav)) {
    const { levels, win, clipped } = soundStats(wav);
    const i0 = Math.ceil((from + 0.1) / win);
    const i1 = Math.min(levels.length, Math.floor(sceneEnd / win));
    const body = levels.slice(i0, i1);
    const peak = Math.max(-200, ...body);
    const silent = runs(body.length, (i) => body[i] < SILENCE_DB).filter(([a, b]) => (b - a + 1) * win >= SILENCE_S).map(([a, b]) => ({ at: +((i0 + a) * win).toFixed(2), seconds: +((b - a + 1) * win).toFixed(2) }));
    const jumps = [];
    for (let i = 1; i < body.length; i++) {
      if (Math.abs(body[i] - body[i - 1]) > JUMP_DB && Math.max(body[i], body[i - 1]) > -40) jumps.push(+((i0 + i) * win).toFixed(2));
    }
    // The sync click is full scale on purpose
    const clips = clipped.filter((t) => t < flashAt - 0.05 || t > flashAt + 0.2);
    sound = { peakDb: +peak.toFixed(1), silent, jumps, clipped: clips.length };
    if (expectSound && peak < SILENCE_DB) reasons.push('no sound');
    else if (expectSound && silent.length) reasons.push(`silent ${silent.map((s) => `${s.seconds} s at ${fmt(s.at)}`).join(', ')}`);
    if (jumps.length) warnings.push(`level jumps at ${jumps.slice(0, 5).map(fmt).join(', ')}`);
    if (clips.length > 20) warnings.push(`${clips.length} clipped samples`);
  } else if (expectSound) reasons.push('no sound file');

  // --- camera from its log: [video s, eye height, ground, water]
  const floor = meta.camera?.floor ?? 3;
  const inBody = cam.filter((r) => r[0] >= from && r[0] <= to);
  const under = inBody.filter((r) => r[3] !== null && r[1] < r[3]);
  const inGround = inBody.filter((r) => r[1] < r[2] + 0.3);
  const low = inBody.filter((r) => r[1] < r[2] + floor - 0.05);
  if (!cam.length) warnings.push('no camera log');
  if (under.length) reasons.push(`camera under water: ${under.length} frames from ${fmt(under[0][0])}`);
  if (inGround.length) reasons.push(`camera in the ground: ${inGround.length} frames from ${fmt(inGround[0][0])}`);
  else if (low.length) warnings.push(`camera below the floor (${floor} m over the ground): ${low.length} frames from ${fmt(low[0][0])}`);
  const minClear = inBody.length ? Math.min(...inBody.map((r) => r[1] - Math.max(r[2], r[3] ?? -Infinity))) : null;

  const verdict = {
    status: reasons.length ? 'red' : 'ok',
    reasons,
    warnings,
    picture: { fps, frames: count, stutters, frozen, stills, black: dark, white: bright },
    sound,
    camera: { frames: inBody.length, minClearance: minClear === null ? null : +minClear.toFixed(2), underWater: under.length, inGround: inGround.length, belowFloor: low.length },
    span: { flash: flashAt, sceneStart, sceneEnd, end: tail },
  };
  writeFileSync(join(dir, 'check.json'), JSON.stringify(verdict, null, 2));
  contactSheet(dir, marks, fps, sceneStart, sceneEnd, count);
  return verdict;
}

/** One frame a second of the scene and one after every labelled step (half a second in), then sheets.py --take */
function contactSheet(dir, marks, fps, sceneStart, sceneEnd, count) {
  const picks = [];
  for (let t = Math.ceil(sceneStart); t <= sceneEnd; t++) picks.push({ t, label: `${t - Math.ceil(sceneStart)} s` });
  for (const m of marks.marks) {
    if (m.video === null || !m.label || !['step', 'mark'].includes(m.kind) || ['head', 'tail', 'end', 'sync'].includes(m.label)) continue;
    picks.push({ t: Math.min(sceneEnd, m.video + 0.5), label: m.label, step: true });
  }
  const frames = [...new Map(picks.map((p) => [Math.min(count - 1, Math.round(p.t * fps)), p])).entries()].sort((a, b) => a[0] - b[0]);
  if (!frames.length) return;
  const folder = join(dir, 'sheet');
  mkdirSync(folder, { recursive: true });
  const select = frames.map(([n]) => `eq(n\\,${n})`).join('+');
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', join(dir, 'video.mkv'), '-an', '-vf', `select='${select}',scale=480:-2`, '-fps_mode', 'vfr', '-q:v', '3', join(folder, '%03d.jpg')]);
  const list = frames.map(([n, p], i) => ({ file: join(folder, `${String(i + 1).padStart(3, '0')}.jpg`), t: +(n / fps).toFixed(2), label: p.label, step: !!p.step }));
  writeFileSync(join(folder, 'frames.json'), JSON.stringify(list, null, 2));
  const r = spawnSync('python', [join(HERE, 'sheets.py'), '--take', dir], { encoding: 'utf8' });
  if (r.status !== 0) console.log(`  contact sheet failed: ${(r.stderr || r.stdout).slice(-500)}`);
}
