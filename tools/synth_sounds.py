# Original "modern iOS-style" UI sounds for Crunch: marimba / glass / bell voices, soft attacks, short room reverb.
# Writes WAV -> MP3 into scratchpad/mp3new and rebuilds the picker page with them.
import os, wave, subprocess, base64
import numpy as np, imageio_ffmpeg

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'mp3new'); os.makedirs(OUT, exist_ok=True)
FF = imageio_ffmpeg.get_ffmpeg_exe()
rng = np.random.default_rng(7)

def note(n):  # MIDI number -> Hz
    return 440.0 * 2 ** ((n - 69) / 12)

def env(t, a=0.004, d=0.6):
    e = np.exp(-t / d); att = np.clip(t / a, 0, 1)
    return e * att

def voice(kind, f, dur, d=None):
    t = np.arange(int(SR * dur)) / SR
    if kind == 'marimba':   # warm, wooden: fundamental + 4x partial that dies fast
        return (np.sin(2 * np.pi * f * t) * env(t, .003, d or .35) + .35 * np.sin(2 * np.pi * f * 4 * t) * env(t, .002, .05))
    if kind == 'glass':     # bright, clean: inharmonic partials like a struck glass
        parts = [(1, 1, d or .9), (2.76, .45, .35), (5.4, .22, .16), (8.93, .1, .08)]
        return sum(g * np.sin(2 * np.pi * f * r * t) * env(t, .002, dd) for r, g, dd in parts)
    if kind == 'bell':      # soft electric-piano bell
        mod = np.sin(2 * np.pi * f * 2 * t) * 1.4 * np.exp(-t / .25)
        return np.sin(2 * np.pi * f * t + mod) * env(t, .004, d or .8)
    if kind == 'pluck':     # rounded pluck
        return (np.sin(2 * np.pi * f * t) + .25 * np.sin(2 * np.pi * f * 2 * t)) * env(t, .002, d or .18)
    if kind == 'pad':       # soft swell for the end-of-day bloom
        a = np.clip(t / .12, 0, 1)
        return (np.sin(2 * np.pi * f * t) + .3 * np.sin(2 * np.pi * f * 2.003 * t)) * a * np.exp(-t / (d or 1.1))
    raise ValueError(kind)

def seq(events, total):
    out = np.zeros(int(SR * total))
    for start, kind, n, gain, *rest in events:
        dur = total - start
        v = voice(kind, note(n), dur, *(rest or [None])) * gain
        i = int(start * SR); out[i:i + len(v)] += v[:len(out) - i]
    return out

def reverb(x, wet=.18, length=.7):
    n = int(SR * length); t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t / (length / 5))
    ir[:int(.012 * SR)] = 0
    y = np.convolve(x, ir)[:len(x)]
    y /= (np.max(np.abs(y)) + 1e-9)
    return x + wet * y * np.max(np.abs(x))

def finish(x, peak=.8):
    x = reverb(x)
    fade = int(.03 * SR); x[-fade:] *= np.linspace(1, 0, fade)
    return x / (np.max(np.abs(x)) + 1e-9) * peak

def save(name, x):
    wav = os.path.join(OUT, name + '.wav'); mp3 = os.path.join(OUT, name + '.mp3')
    with wave.open(wav, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())
    subprocess.run([FF, '-y', '-loglevel', 'error', '-i', wav, '-b:a', '128k', mp3], check=True)
    os.remove(wav)
    return mp3

C5, D5, E5, G5, A5, B5, C6, D6, E6, G6 = 72, 74, 76, 79, 81, 83, 84, 86, 88, 91
SOUNDS = {
  # task done on time: short, bright, rising
  'W1': finish(seq([(0, 'glass', G5, .7), (.09, 'glass', D6, .8)], .9)),
  'W2': finish(seq([(0, 'marimba', C6, .7), (.07, 'marimba', E6, .7), (.14, 'marimba', G6, .8)], .8)),
  'W3': finish(seq([(0, 'bell', E6, .8, .6), (0, 'bell', B5, .35, .6)], 1.0)),
  'W4': finish(seq([(0, 'pluck', C6, .6), (.045, 'pluck', E6, .6), (.09, 'pluck', G6, .6), (.135, 'glass', C6 + 12, .5, .5)], .9)),
  'W5': finish(seq([(0, 'marimba', G5, .6), (.08, 'glass', D6, .6), (.08, 'glass', G6, .35)], 1.0)),
  # task done late: soft, low, falling, no drama
  'L1': finish(seq([(0, 'marimba', E5, .7), (.12, 'marimba', C5, .7)], .7), .55),
  'L2': finish(seq([(0, 'pluck', A5 - 12, .8, .3)], .5), .5),
  'L3': finish(seq([(0, 'bell', D5, .6, .4), (.1, 'bell', A5 - 12, .5, .5)], .8), .5),
  # better than yesterday: a little fanfare that blooms
  'B1': finish(seq([(0, 'marimba', C5, .5), (.1, 'marimba', E5, .5), (.2, 'marimba', G5, .5), (.3, 'glass', C6, .7, 1.2),
                    (.3, 'pad', C5, .25, 1.2), (.3, 'pad', G5, .18, 1.2)], 1.8)),
  'B2': finish(seq([(0, 'glass', G5, .5), (.08, 'glass', C6, .5), (.16, 'glass', E6, .5), (.24, 'glass', G6, .7, 1.4)], 1.7)),
  'B3': finish(seq([(0, 'bell', C6, .6, 1.0), (.12, 'bell', G6, .5, 1.0), (.12, 'pad', C5, .3, 1.4), (.12, 'pad', E5, .2, 1.4)], 1.8)),
  'B4': finish(seq([(0, 'pluck', E5, .5), (.06, 'pluck', G5, .5), (.12, 'pluck', B5, .5), (.18, 'pluck', D6, .5), (.26, 'glass', E6, .7, 1.2), (.26, 'pad', E5, .2, 1.3)], 1.7)),
  # worse than yesterday: calm, minor, falling
  'X1': finish(seq([(0, 'marimba', E5, .6), (.16, 'marimba', C5, .6), (.32, 'pad', A5 - 12, .3, .9)], 1.3), .6),
  'X2': finish(seq([(0, 'bell', G5, .5, .7), (.18, 'bell', E5 - 1, .5, .9)], 1.3), .6),
  'X3': finish(seq([(0, 'pad', A5 - 12, .4, 1.0), (0, 'pad', C5, .3, 1.0), (0, 'pad', E5, .25, 1.0)], 1.3), .55),
}
paths = {k: save(k, v) for k, v in SOUNDS.items()}
print('made', len(paths))
