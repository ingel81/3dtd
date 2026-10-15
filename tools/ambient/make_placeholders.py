"""Placeholder ambient loops for custom maps (TODO E190): synthesised, no samples, no licence.

Writes public/assets/sounds/ambient/<id>.mp3 (mono, 44.1 kHz). Each loop is periodic: noise is
filtered in the frequency domain over the whole loop (circular), envelopes and calls wrap round,
so the end runs into the start without a seam. The file holds the loop with PAD seconds of it
repeated before and after; the game loops from PAD to the end minus PAD (soundscape.ts
LOOP_PAD), which hides the MP3 encoder's delay at both ends. Real recordings replace these
later (tmp/plan/AMBIENT_SOUNDS_2026-10-15.md); the ids stay.

    python -I tools/ambient/make_placeholders.py public/assets/sounds/ambient [<id> ...]
"""
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

RATE = 44100
LOOP = 16.0
PAD = 0.1
N = int(RATE * LOOP)
T = np.arange(N) / RATE


def band(rng, lo, hi, tilt=0.0):
    """Periodic noise between lo and hi Hz; tilt < 0 darkens (amplitude ~ f ** tilt)"""
    spec = np.fft.rfft(rng.standard_normal(N))
    f = np.fft.rfftfreq(N, 1 / RATE)
    gain = np.where((f >= lo) & (f <= hi), 1.0, 0.0)
    # Soft edges: half an octave
    if lo > 0:
        gain = np.maximum(gain, np.exp(-((np.log2(np.maximum(f, 1) / lo)) ** 2) * 8) * (f < lo))
    gain = np.maximum(gain, np.exp(-((np.log2(np.maximum(f, 1) / hi)) ** 2) * 8) * (f > hi))
    gain *= np.maximum(f, 20) ** tilt
    out = np.fft.irfft(spec * gain, N)
    return out / (np.std(out) + 1e-9)


def slow(rng, cutoff):
    """A smooth random envelope 0..1, periodic, changing slower than cutoff Hz"""
    e = band(rng, 0.0, cutoff)
    return (e - e.min()) / (e.max() - e.min() + 1e-9)


def cycles(k, phase=0.0):
    """A sine with k whole cycles per loop"""
    return np.sin(2 * np.pi * k * T / LOOP + phase)


def add(out, start, sig):
    """Adds sig at sample start, wrapping round the loop"""
    idx = (np.arange(len(sig)) + start) % N
    np.add.at(out, idx, sig)


def tone(freqs, amp_env):
    """A tone following a frequency curve (Hz per sample) with an amplitude envelope"""
    phase = 2 * np.pi * np.cumsum(freqs) / RATE
    return np.sin(phase) * amp_env


def window(n):
    return np.sin(np.linspace(0, np.pi, n)) ** 2


def wind(rng):
    low = band(rng, 40, 320, -0.6) * (0.55 + 0.45 * slow(rng, 0.15))
    gust = slow(rng, 0.25) ** 2
    high = band(rng, 300, 1400, -0.3) * gust
    whistle = band(rng, 520, 600) * gust ** 2 * 0.25
    return low + 0.8 * high + whistle


def birdsong(rng):
    out = wind(rng) * 0.25
    for _ in range(14):
        start = int(rng.uniform(0, N))
        f0 = rng.uniform(2400, 4800)
        notes = rng.integers(3, 7)
        at = start
        for _ in range(notes):
            n = int(rng.uniform(0.05, 0.13) * RATE)
            sweep = np.linspace(f0, f0 * rng.uniform(0.75, 1.35), n) + 180 * np.sin(np.linspace(0, rng.uniform(6, 20), n))
            note = tone(sweep, window(n)) + 0.2 * tone(sweep * 2, window(n))
            add(out, at, note * rng.uniform(0.6, 1.4) * 1.6)
            at += n + int(rng.uniform(0.02, 0.09) * RATE)
            f0 *= rng.uniform(0.9, 1.12)
    return out


def night_insects(rng):
    out = band(rng, 60, 400, -0.5) * 0.15
    for carrier, chirps, level in ((4300, 26, 1.0), (4750, 21, 0.7), (3900, 17, 0.5)):
        pulse = int(0.016 * RATE)
        for c in range(chirps):
            at = int((c / chirps) * N + rng.uniform(0, 0.05) * RATE)
            for p in range(int(rng.integers(3, 5))):
                n = pulse
                t = np.arange(n) / RATE
                add(out, at + p * int(0.032 * RATE), np.sin(2 * np.pi * carrier * t) * window(n) * level)
    return out


def stream(rng):
    babble = band(rng, 300, 4500, -0.2) * (0.4 + 0.6 * slow(rng, 9.0))
    out = babble * 0.9
    for _ in range(260):
        n = int(rng.uniform(0.012, 0.03) * RATE)
        f = np.linspace(rng.uniform(300, 700), rng.uniform(800, 1600), n)
        add(out, int(rng.uniform(0, N)), tone(f, window(n)) * rng.uniform(0.2, 0.7))
    return out


def surf(rng):
    # Two waves a loop: the swell rises, breaks and runs back hissing
    phase = (T / (LOOP / 2)) % 1.0
    rise = np.clip(phase / 0.3, 0, 1) ** 2
    fall = np.exp(-np.clip(phase - 0.3, 0, None) * 4)
    swell = np.where(phase < 0.3, rise, fall)
    crash = np.clip((phase - 0.27) / 0.04, 0, 1) * np.exp(-np.clip(phase - 0.31, 0, None) * 9)
    hiss = np.clip((phase - 0.35) / 0.2, 0, 1) * np.clip((1 - phase) / 0.35, 0, 1)
    return band(rng, 30, 400, -0.8) * (0.35 + 0.65 * swell) + band(rng, 600, 6000, -0.2) * (crash * 1.2 + hiss * 0.5)


def swamp(rng):
    out = night_insects(rng) * 0.4 + band(rng, 40, 250, -0.6) * 0.3
    for _ in range(18):
        f = rng.uniform(110, 210)
        at = int(rng.uniform(0, N))
        for p in range(int(rng.integers(2, 4))):
            n = int(0.07 * RATE)
            t = np.arange(n) / RATE
            croak = np.sign(np.sin(2 * np.pi * f * t)) * 0.5 + np.sin(2 * np.pi * f * 2 * t) * 0.5
            add(out, at + p * int(0.11 * RATE), croak * window(n) * 0.9)
    return out


def lava(rng):
    out = band(rng, 18, 140, -1.0) * (0.6 + 0.4 * slow(rng, 0.3)) * 1.3
    for _ in range(70):
        n = int(rng.uniform(0.05, 0.14) * RATE)
        f = np.linspace(rng.uniform(70, 140), rng.uniform(160, 320), n)
        add(out, int(rng.uniform(0, N)), tone(f, window(n)) * rng.uniform(0.3, 0.9))
    return out + band(rng, 1500, 6000) * slow(rng, 0.4) ** 3 * 0.25


def fire(rng):
    out = band(rng, 80, 900, -0.6) * (0.5 + 0.5 * slow(rng, 4.0)) * 0.7
    for _ in range(420):
        n = int(rng.uniform(0.002, 0.008) * RATE)
        click = rng.standard_normal(n) * np.exp(-np.linspace(0, 6, n))
        add(out, int(rng.uniform(0, N)), click * rng.uniform(0.3, 2.0) ** 2)
    return out


def city(rng):
    hum = band(rng, 35, 450, -0.7) * (0.7 + 0.3 * slow(rng, 0.2))
    return hum + 0.12 * np.sin(2 * np.pi * 100 * T) + band(rng, 800, 3000) * slow(rng, 0.5) ** 4 * 0.3


def gulls(rng):
    out = wind(rng) * 0.2 + band(rng, 200, 1500, -0.5) * slow(rng, 0.3) * 0.25
    for _ in range(12):
        at = int(rng.uniform(0, N))
        for _ in range(int(rng.integers(1, 4))):
            n = int(rng.uniform(0.25, 0.45) * RATE)
            f0 = rng.uniform(1500, 2100)
            f = np.linspace(f0, f0 * rng.uniform(0.45, 0.6), n) * (1 + 0.03 * np.sin(np.linspace(0, 40, n)))
            env = window(n) ** 0.7
            call = tone(f, env) + 0.4 * tone(f * 2, env) + 0.2 * tone(f * 3, env)
            add(out, at, call * rng.uniform(0.4, 1.0))
            at += n + int(rng.uniform(0.05, 0.2) * RATE)
    return out


def crows(rng):
    out = wind(rng) * 0.35
    for _ in range(9):
        at = int(rng.uniform(0, N))
        for _ in range(int(rng.integers(2, 4))):
            n = int(rng.uniform(0.22, 0.32) * RATE)
            f = np.linspace(rng.uniform(560, 700), rng.uniform(420, 520), n)
            env = window(n) ** 0.5
            # Harsh: a buzzing tone through noise
            caw = np.sign(tone(f, env)) * env * 0.4 + tone(f * 2.1, env) * 0.3 + rng.standard_normal(n) * env * 0.25
            add(out, at, caw * rng.uniform(0.5, 1.0))
            at += n + int(rng.uniform(0.12, 0.25) * RATE)
    return out


def radio_hiss(rng):
    out = band(rng, 900, 7000, -0.2) * (0.5 + 0.5 * slow(rng, 0.6)) * 0.5 + 0.08 * np.sin(2 * np.pi * 60 * T)
    for c in range(10):
        n = int(0.08 * RATE)
        add(out, int((c / 10) * N + rng.uniform(0, 0.5) * RATE), np.sin(2 * np.pi * rng.choice([880, 1320]) * np.arange(n) / RATE) * window(n) * 0.6)
    return out


SOUNDS = {
    'wind': wind,
    'birdsong': birdsong,
    'night-insects': night_insects,
    'stream': stream,
    'surf': surf,
    'swamp': swamp,
    'lava': lava,
    'fire': fire,
    'city': city,
    'gulls': gulls,
    'crows': crows,
    'radio-hiss': radio_hiss,
}


def write(signal, path):
    signal = signal - signal.mean()
    # About -18 dBFS RMS, peaks held under -1 dBFS
    signal *= 10 ** (-18 / 20) / (np.sqrt(np.mean(signal ** 2)) + 1e-9)
    peak = np.max(np.abs(signal))
    if peak > 0.89:
        signal = np.tanh(signal / 0.89) * 0.89
    pad = int(PAD * RATE)
    full = np.concatenate([signal[-pad:], signal, signal[:pad]])
    pcm = (np.clip(full, -1, 1) * 32767).astype('<i2')
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, 'loop.wav')
        with wave.open(wav, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(pcm.tobytes())
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '56k', '-ac', '1', path], check=True)


def main():
    out_dir = sys.argv[1]
    only = set(sys.argv[2:])
    os.makedirs(out_dir, exist_ok=True)
    for k, (name, make) in enumerate(SOUNDS.items()):
        if only and name not in only:
            continue
        rng = np.random.default_rng(1000 + k)
        write(make(rng), os.path.join(out_dir, f'{name}.mp3'))
        print(name)


if __name__ == '__main__':
    main()
