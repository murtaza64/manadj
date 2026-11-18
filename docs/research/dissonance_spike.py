"""Chords/dissonance spike for manaDJ #79 (chroma seam).

Synthetic chords with harmonic partials -> 12-bin chroma -> two candidate
dissonance scalars:
  1. Sethares/Plomp-Levelt spectral roughness over partials.
  2. Chroma interval-tension scalar (pitch-class pairs weighted by a
     tension table derived from the same roughness curve on an idealized
     6-harmonic dyad).
Plus a triadic-template distance as an 'unexplained harmony' measure.
No user audio; all signals synthesized here.
"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

SR = 44100
DUR = 2.0
N_HARM = 6

def tone(freq, dur=DUR, sr=SR, n_harm=N_HARM):
    t = np.arange(int(sr * dur)) / sr
    x = np.zeros_like(t)
    for h in range(1, n_harm + 1):
        x += (1.0 / h) * np.sin(2 * np.pi * freq * h * t)
    env = np.minimum(1.0, np.minimum(t / 0.01, (dur - t) / 0.05)).clip(0, 1)
    return x * env

def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)

CHORDS = {
    "octave (A2+A3)": [45, 57],
    "fifth (A2+E3)": [45, 52],
    "maj triad (A2 C#3 E3)": [45, 49, 52],
    "min triad (A2 C3 E3)": [45, 48, 52],
    "sus4 (A2 D3 E3)": [45, 50, 52],
    "maj7 (A2 C#3 E3 G#3)": [45, 49, 52, 56],
    "dom7 (A2 C#3 E3 G3)": [45, 49, 52, 55],
    "dim triad (A2 C3 Eb3)": [45, 48, 51],
    "aug triad (A2 C#3 F3)": [45, 49, 53],
    "tritone dyad (A2+Eb3)": [45, 51],
    "min2 cluster (A2+Bb2)": [45, 46],
    "cluster (A2 Bb2 B2)": [45, 46, 47],
}

def partials(midis):
    ps = []
    for m in midis:
        f0 = midi_hz(m)
        for h in range(1, N_HARM + 1):
            ps.append((f0 * h, 1.0 / h))
    return ps

# --- Sethares roughness (Plomp-Levelt exponential curve) ---
def roughness(ps):
    total = 0.0
    for i in range(len(ps)):
        f1, a1 = ps[i]
        for j in range(i + 1, len(ps)):
            f2, a2 = ps[j]
            if f2 < f1:
                f1, f2, a1, a2 = f2, f1, a2, a1
            s = 0.24 / (0.0207 * f1 + 18.96)
            x = s * (f2 - f1)
            d = a1 * a2 * (np.exp(-3.5 * x) - np.exp(-5.75 * x))
            total += d
    return total

# --- chroma from partials (peak-picking-free: direct partial fold) ---
def chroma_from_partials(ps):
    c = np.zeros(12)
    for f, a in ps:
        pc = int(round(12 * np.log2(f / 440.0))) % 12  # C-based: 440Hz -> pc 9 (A)
        pc = (pc + 3) % 12  # shift so index 0 = C
        c[pc] += a
    return c / np.linalg.norm(c)

# --- tension table: roughness of an idealized 6-harmonic dyad per interval,
#     normalized so perfect fifth ~ 0 and minor second ~ 1 ---
def dyad_tension_table():
    vals = []
    for iv in range(13):
        ps = partials([45, 45 + iv])
        vals.append(roughness(ps))
    vals = np.array(vals)
    lo, hi = vals[7], vals[1]  # fifth as floor, minor second as ceiling
    return np.clip((vals - lo) / (hi - lo), 0, 1)

TENSION = dyad_tension_table()

def chroma_tension(c):
    total, w = 0.0, 0.0
    for i in range(12):
        for j in range(i + 1, 12):
            iv = min(j - i, 12 - (j - i))
            total += c[i] * c[j] * TENSION[iv]
            w += c[i] * c[j]
    return total / w if w > 0 else 0.0

# --- triadic template distance: best cosine fit over 24 maj/min triads ---
def triad_templates():
    temps = {}
    for root in range(12):
        for name, ivs in (("maj", [0, 4, 7]), ("min", [0, 3, 7])):
            t = np.zeros(12)
            for iv in ivs:
                t[(root + iv) % 12] = 1.0
            temps[f"{root}{name}"] = t / np.linalg.norm(t)
    return temps

TEMPS = triad_templates()

def triad_distance(c):
    best = max(float(c @ t) for t in TEMPS.values())
    return 1.0 - best

rows = []
for name, midis in CHORDS.items():
    ps = partials(midis)
    r = roughness(ps)
    c = chroma_from_partials(ps)
    ct = chroma_tension(c)
    td = triad_distance(c)
    rows.append((name, r, ct, td))

rows.sort(key=lambda x: x[1])
rmax = max(r[1] for r in rows)
ctmax = max(r[2] for r in rows)

print(f"{'chord':34s} {'rough':>7s} {'chrT':>6s} {'triD':>6s}")
for name, r, ct, td in rows:
    print(f"{name:34s} {r:7.3f} {ct:6.3f} {td:6.3f}")

# --- chart, manaDJ tokens ---
BG, PANEL, TXT, SUB = "#111111", "#1e1e1e", "#cdd6f4", "#a6adc8"
ACC, WARN, ROUT = "#4a9eff", "#ffcc00", "#a8ff00"
plt.rcParams.update({
    "font.family": "Ubuntu Mono", "text.color": TXT, "axes.edgecolor": "#45454f",
    "axes.labelcolor": SUB, "xtick.color": SUB, "ytick.color": SUB,
    "figure.facecolor": BG, "axes.facecolor": PANEL, "savefig.facecolor": BG,
})
names = [r[0] for r in rows]
y = np.arange(len(rows))
fig, axes = plt.subplots(1, 3, figsize=(16, 7), sharey=True)
for ax, idx, color, title in (
    (axes[0], 1, ACC, "spectral roughness (Sethares)"),
    (axes[1], 2, ROUT, "chroma tension (this spike)"),
    (axes[2], 3, WARN, "triad-template distance"),
):
    vals = [r[idx] for r in rows]
    ax.barh(y, vals, color=color, height=0.7)
    ax.set_yticks(y, names, fontsize=10)
    ax.invert_yaxis()
    ax.set_title(title, fontsize=12, color=TXT, pad=10)
    ax.grid(axis="x", color="#313136", lw=0.5)
    ax.set_axisbelow(True)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
fig.suptitle("#79 spike: candidate dissonance scalars on synthetic chords (low = consonant)",
             fontsize=14, color=TXT, y=0.98)
fig.tight_layout(rect=[0, 0, 1, 0.95])
fig.savefig("/downloads/manadj-79-dissonance-spike.png", dpi=130)
print("chart written")
