# Turning a Photo into Clean Sketch Lines

The engine's job is to convert a photograph into lines a person could actually
draw — clean, connected contours, **not** a noisy trace of every pixel. This note
compares the options and records why we chose **XDoG**.

---

## The problem with our first version (Sobel)

The **Sobel operator** computes the *gradient magnitude* at every pixel — i.e.
"how fast is brightness changing here." Thresholding that gives you an edge map,
but on a real photo it has two fatal flaws for sketching:

- **It traces texture, not form.** Skin pores, stubble, hair strands, fabric
  weave and JPEG noise all have strong local gradients, so a face turns into a
  dense scribble of tiny marks — a "photocopy," not a sketch.
- **Thick, broken bands.** Sobel edges are fat and fragmented, not the thin,
  confident, continuous lines a person draws.

No amount of threshold tuning fixes this, because the *character* of the output is
wrong. We needed a different operator.

---

## Difference-of-Gaussians (DoG)

Blur the grayscale image twice at two scales and subtract:

```
DoG(x) = G_σ(x) − G_{k·σ}(x)
```

`G_σ` is a Gaussian blur with standard deviation σ; `k` is the scale ratio
(≈1.6 approximates the Laplacian-of-Gaussian). The zero-crossings of the DoG are
edges. Because it works on **blurred** versions of the image, the σ blur throws
away fine texture below its scale — so raising σ makes texture like skin pores
simply disappear while the big contours survive. That is exactly the knob Sobel
lacked.

---

## XDoG — eXtended Difference-of-Gaussians ✅ (what we use)

Winnemöller's **XDoG** extends DoG with a sharpening term and a soft threshold to
produce genuinely stylised, hand-drawn-looking lines.

**Step 1 — sharpened DoG:**

```
D_{σ,k,τ}(x) = G_σ(x) − τ · G_{k·σ}(x)
```

τ (tau, ~0.98) controls how much of the second blur is subtracted; near 1 it
sharpens and thins the lines.

**Step 2 — soft (tanh) threshold** into an ink/paper value:

```
          ⎧ 1                              if D ≥ ε
T(D) =    ⎨
          ⎩ 1 + tanh( φ · (D − ε) )        otherwise
```

- **ε (epsilon)** — the ink threshold. Raise it → more of the image becomes line.
- **φ (phi)** — the softness/hardness of the line's edge. Large φ → crisp,
  ink-like strokes; small φ → soft pencil.

The output (scaled to 0–255) is a clean black-on-white line drawing.

### Why it fixes our face problem

- **σ (base blur) = the "skip texture" knob.** A moderate σ (≈1.4) blurs away
  skin pores/stubble/noise *before* any edge is found, so the face keeps its
  meaningful contours (jaw, nose, lips, eyes, brows) and drops the muddy scribble.
- Lines come out **thin and connected**, like a pen drawing.
- The whole thing is a couple of Gaussian blurs + a per-pixel formula — cheap
  enough to run in the browser with no libraries.

### Parameter values (from implementations + our tuning)

| Look | σ | k | τ | φ | ε |
|------|----|----|----|----|----|
| Clean lines | ~0.4–1.0 | 1.6 | 0.5–0.98 | 10–25 | small (≈ 0) |
| Natural / softer media | ~1.0 | 1.6 | 0.5 | ~10 | negative |
| Bolder block-in outline | ~2.0–2.6 | 1.6 | ~0.97 | ~20 | higher |

We run XDoG **twice**: a higher-σ, higher-threshold pass for the bold *block-in*
outline (big shapes only), and a lower-σ pass for the detailed line work.

---

## FDoG (flow-based DoG) — the next level (not used yet)

**Flow-based DoG** first estimates the local **Edge Tangent Flow** (the direction
edges "want" to run) and smooths the DoG *along* that flow. The result is even
cleaner, more coherent, more calligraphic linework. It's heavier to compute and
overkill for our needs today, but it's the natural future upgrade.

---

## Canny — good edges, wrong style

Canny (Gaussian blur → gradient → **non-maximum suppression** → **hysteresis
thresholding**) yields excellent *thin, connected* edges and is the classic
computer-vision edge detector. But its output still looks like a technical edge
map rather than an expressive drawing, and the double-threshold + NMS machinery is
more code for a less "sketchy" result than XDoG. Its best ideas — pre-blur to kill
noise, and thin lines — are things XDoG gives us more artistically.

---

## Summary of the decision

| Operator | Texture handling | Line quality | Style | Verdict |
|----------|------------------|--------------|-------|---------|
| Sobel | traces all texture ❌ | thick, broken | photocopy | replaced |
| DoG | σ skips texture ✅ | soft | edge-y | basis for XDoG |
| **XDoG** | **σ skips texture ✅** | **thin, connected** | **hand-drawn** | **chosen** |
| FDoG | best | best, coherent | calligraphic | future upgrade |
| Canny | good | thin, connected | technical | not stylised enough |

---

## Sources

- Winnemöller, Kyprianidis, Olsen — *XDoG: An eXtended difference-of-Gaussians compendium including advanced image stylization* (Computers & Graphics, 2012): <https://users.cs.northwestern.edu/~sco590/winnemoeller-cag2012.pdf>
- ScienceDirect record for the XDoG paper: <https://www.sciencedirect.com/science/article/abs/pii/S009784931200043X>
- heitorrapela/xdog — reference implementation & parameter sets: <https://github.com/heitorrapela/xdog>
- *An extended flow-based difference-of-Gaussians method of line drawing* (FDoG): <https://www.sciencedirect.com/science/article/abs/pii/S0030402614006160>
