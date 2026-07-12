# ✏️ Sketch on Your Own

Upload **any** photo and the app turns it into a **point-by-point drawing tutorial** — with
both **visual animations** and **written instructions** — so anyone can hand-draw an accurate
sketch of that photo using the classic **grid method**.

No accounts. No uploads. No API keys. **100% free and runs entirely in your browser.**

## What it does

1. **Upload a photo** (or pick a built-in sample). Your image never leaves your device.
2. The app lays a **rectangular grid** over the photo — the same technique artists use to copy
   proportions accurately.
3. It **traces the edges** of the photo to work out the sketch lines.
4. You're taught **in phases, the way real instructors teach** (see
   [`resources/`](./resources/) for the research behind this):
   1. **Overview** — set up the grid.
   2. **Block-in** — lay down only the big shapes first.
   3. **Proportions** — for portraits, Loomis-style guide lines (brow / eye / nose / mouth).
   4. **Detail** — clean sketch lines revealed one grid cell at a time, **face first**.
   5. **Shading** — squint for the darks, then build them with hatching.
   6. **Finish** — erase the grid; you've drawn the photo.
5. The **full sketch is shown right away** — click **any step** to replay just that part, hit
   **▶ Watch it drawn** to build the whole thing from blank paper, or **Play** for a guided tour.
6. Every step has a **written instruction** alongside the visual.

### ✨ Clean lines, not a photocopy

The sketch lines come from **XDoG (eXtended Difference-of-Gaussians)**, not raw edge detection.
Plain edge detection traces every skin pore, shadow and bit of texture, so faces came out as a
muddy scribble. XDoG's base blur skips fine texture and produces **thin, connected, hand-drawn
-looking lines**. Full write-up in
[`resources/photo-to-lineart-algorithms.md`](./resources/photo-to-lineart-algorithms.md).

### 👤 Face-aware

The most important part of a portrait is the face, so the app:

- **Finds the face** using skin-tone analysis (YCbCr — works across skin tones, no libraries or
  network), shown as a dashed box on the reference photo.
- Adds **Loomis proportion guides** so features are placed correctly (the eyes sit halfway down
  the head — the #1 beginner fix).
- **Draws the face first**, before the background.

## How to use it

Just open `index.html` in any modern browser. That's it — there's no build step and no
dependencies.

Or serve it statically:

```bash
# any static server works, e.g.:
python3 -m http.server 8000
# then visit http://localhost:8000
```

### Controls

- **Grid detail** — how many columns the grid uses (coarser = easier, finer = more accurate).
- **Line sensitivity** — how many edge lines are detected (higher = more detail).
- **Speed** — animation speed.
- **▶ / ⏸ / ⏮ / ⏭ / ⟲** — play, pause, previous step, next step, restart.
- **Keyboard**: `←` / `→` to step, `Space` to play/pause.

## How it works under the hood

Everything is done client-side with the Canvas API — no libraries, no network:

- The image is scaled to a working resolution and converted to grayscale.
- **XDoG** (two Gaussian blurs + a sharpening term + a tanh soft-threshold) produces the clean
  line art. It runs twice: a bold, large-blur pass for the **block-in** outline, and a finer
  pass for the **detail** line work.
- A **skin-tone (YCbCr)** pass locates the face and derives **Loomis proportion guides**.
- The photo is quantised into value bands to drive the **hatched shading** layer.
- The grid is overlaid, and each cell is analyzed for **brightness**, **line density**, and
  **dominant line orientation** — turned into a plain-English instruction. Cells are ordered
  **face-first**.
- The finished line drawing is shown at once; selecting a step replays just that phase/cell
  with a "pencil" animation.

See the [`resources/`](./resources/) folder for the drawing-pedagogy and image-processing
research this is all based on.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup and layout |
| `styles.css` | Styling |
| `app.js` | All logic: image processing, grid analysis, instructions, animation |

No frameworks, no network calls, no tracking.
