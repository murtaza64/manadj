"""#79 spike v2: fix the two failures from v1.

v1 findings to check:
  - raw Sethares roughness grows with note count (maj triad > 3-note cluster).
  - naive chroma tension saturates (~1 everywhere) because every chord's own
    overtone series activates the same pitch classes.

v2 candidates:
  R_pair  = mean roughness per partial pair (count-normalized)
  T_resid = tension of chroma residual after removing the best maj/min
            triad template (tension beyond the best triad)
Register probe: same chords at A2 (110 Hz) and A4 (440 Hz).
"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

SR = 44100
N_HARM = 6

def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)

def partials(midis):
    ps = []
    for m in midis:
        f0 = midi_hz(m)
        for h in range(1, N_HARM + 1):
            ps.append((f0 * h, 1.0 / h))
    return ps

def roughness_sum(ps):
    total = 0.0
    for i in range(len(ps)):
        f1, a1 = ps[i]
        for j in range(i + 1, len(ps)):
            f2, a2 = ps[j]
            if f2 < f1:
                f1, f2, a1, a2 = f2, f1, a2, a1
            s = 0.24 / (0.0207 * f1 + 18.96)
            x = s * (f2 - f1)
            total += a1 * a2 * (np.exp(-3.5 * x) - np.exp(-5.75 * x))
    return total

def roughness_per_pair(ps):
    n = len(ps) * (len(ps) - 1) / 2
    return roughness_sum(ps) / n

def chroma_from_partials(ps):
    c = np.zeros(12)
    for f, a in ps:
        pc = (int(round(12 * np.log2(f / 440.0))) % 12 + 3) % 12
        c[pc] += a
    return c / np.linalg.norm(c)

def dyad_tension_table():
    vals = np.array([roughness_sum(partials([57, 57 + iv])) for iv in range(13)])
    lo, hi = vals[7], vals[1]
    return np.clip((vals - lo) / (hi - lo), 0, 1)

TENSION = dyad_tension_table()

def triad_templates():
    temps = []
    for root in range(12):
        for ivs in ([0, 4, 7], [0, 3, 7]):
            t = np.zeros(12)
            for iv in ivs:
                t[(root + iv) % 12] = 1.0
            temps.append(t / np.linalg.norm(t))
    return temps

TEMPS = triad_templates()

def residual_tension(c):
    sims = [float(c @ t) for t in TEMPS]
    k = int(np.argmax(sims))
    resid = np.clip(c - sims[k] * TEMPS[k], 0, None)
    if not resid.any():
        return 0.0
    total, w = 0.0, 0.0
    for i in range(12):
        for j in range(i + 1, 12):
            iv = min(j - i, 12 - (j - i))
            total += resid[i] * resid[j] * TENSION[iv]
            w += resid[i] * resid[j]
    # scale by residual energy so a near-pure triad stays near 0 even if
    # its small residue sits on a tense interval
    energy = float(np.sum(resid ** 2))
    return (total / w if w > 0 else 0.0) * min(1.0, energy * 8)

CHORDS = {
    "octave": [0, 12],
    "fifth": [0, 7],
    "maj triad": [0, 4, 7],
    "min triad": [0, 3, 7],
    "sus4": [0, 5, 7],
    "maj7": [0, 4, 7, 11],
    "dom7": [0, 4, 7, 10],
    "dim triad": [0, 3, 6],
    "aug triad": [0, 4, 8],
    "tritone dyad": [0, 6],
    "min2 dyad": [0, 1],
    "min2+2 cluster": [0, 1, 2],
}

REGISTERS = {"A2 (110Hz)": 45, "A4 (440Hz)": 69}
results = {}
for reg, root in REGISTERS.items():
    for name, ivs in CHORDS.items():
        midis = [root + iv for iv in ivs]
        ps = partials(midis)
        c = chroma_from_partials(ps)
        results[(reg, name)] = (roughness_per_pair(ps), residual_tension(c))

print(f"{'chord':16s} {'Rpair@A2':>9s} {'Rpair@A4':>9s} {'Tresid':>7s}")
for name in CHORDS:
    r2 = results[("A2 (110Hz)", name)][0]
    r4 = results[("A4 (440Hz)", name)][0]
    tr = results[("A4 (440Hz)", name)][1]
    print(f"{name:16s} {r2:9.4f} {r4:9.4f} {tr:7.3f}")

# chart: two panels, each sorted by its own scalar; ordering is illustrative
BG, PANEL, TXT, SUB = "#111111", "#1e1e1e", "#cdd6f4", "#a6adc8"
ACC, ROUT, WARN = "#4a9eff", "#a8ff00", "#ffcc00"
plt.rcParams.update({
    "font.family": "Ubuntu Mono", "text.color": TXT, "axes.edgecolor": "#45454f",
    "axes.labelcolor": SUB, "xtick.color": SUB, "ytick.color": SUB,
    "figure.facecolor": BG, "axes.facecolor": PANEL, "savefig.facecolor": BG,
})
names = list(CHORDS)
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15, 6.5))

o1 = sorted(names, key=lambda n: results[("A4 (440Hz)", n)][0])
x = np.arange(len(o1)); w = 0.38
r2 = [results[("A2 (110Hz)", n)][0] for n in o1]
r4 = [results[("A4 (440Hz)", n)][0] for n in o1]
ax1.bar(x - w/2, r2, w, color=ACC, label="110 Hz root")
ax1.bar(x + w/2, r4, w, color=ROUT, label="440 Hz root")
ax1.set_xticks(x, o1, rotation=35, ha="right", fontsize=10)
ax1.set_title("spectral roughness per partial pair (Sethares)", fontsize=12, color=TXT, pad=10)
ax1.legend(facecolor=PANEL, edgecolor="#45454f", labelcolor=TXT, fontsize=10)

o2 = sorted(names, key=lambda n: results[("A4 (440Hz)", n)][1])
tr = [results[("A4 (440Hz)", n)][1] for n in o2]
ax2.bar(np.arange(len(o2)), tr, 0.6, color=WARN)
ax2.set_xticks(np.arange(len(o2)), o2, rotation=35, ha="right", fontsize=10)
ax2.set_title("residual chroma tension (beyond best triad)", fontsize=12, color=TXT, pad=10)

for ax in (ax1, ax2):
    ax.grid(axis="y", color="#313136", lw=0.5); ax.set_axisbelow(True)
    for s in ("top", "right"): ax.spines[s].set_visible(False)
fig.suptitle("#79 spike: candidate dissonance scalars, synthetic chords\nordering illustrative, not a validated consonance ranking",
             fontsize=13, color=TXT)
fig.tight_layout(rect=[0,0,1,0.92])
fig.savefig("/downloads/manadj-79-dissonance-spike.png", dpi=130)
print("chart written")
