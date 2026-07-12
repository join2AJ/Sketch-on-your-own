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
4. The **full sketch is shown right away**. You don't have to sit through a slideshow —
   click **any step** (or a cell in the list) and just that grid cell is re-drawn with a
   highlight so you can study it. There's also a **▶ Watch it drawn** button that builds the
   whole sketch from blank paper, and a **Play** button that takes you on a guided cell-by-cell
   tour.
5. Every step gives a **written instruction** (how many lines, their direction, how light/dark
   to shade) alongside the visual.
6. At the end, you **erase the grid** — and you've drawn the photo.

### 👤 Face-aware

Portraits get special treatment. The most important part of a portrait is the face, so the app:

- **Finds the face** using skin-tone analysis (YCbCr — works across skin tones, no libraries or
  network), shown as a dashed box on the reference photo.
- Draws the **face with much higher detail and darker, crisper lines** so the eyes, brows, nose
  and mouth actually come through.
- **Declutters busy backgrounds** (foliage, texture) with adaptive thresholding, so the subject
  stands out instead of getting lost in noise.

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

Everything is done client-side with the Canvas API:

- The image is scaled to a working resolution and converted to grayscale.
- A light blur + **Sobel operator** computes edge magnitude and gradient direction.
- Edge strength is **normalized by a high percentile** (not the raw max) so a few very strong
  background edges can't crush the subtle facial edges.
- A **skin-tone (YCbCr) pass** locates the face region.
- Edges are kept using an **adaptive, face-aware threshold**: low (sensitive) inside the face,
  higher in busy background areas — then rendered as dark lines on white.
- The grid is overlaid, and each cell is analyzed for **brightness**, **edge density**, and
  **dominant line orientation** — which is turned into a plain-English instruction (face cells
  are flagged so you take extra care there).
- The finished sketch is shown at once; selecting a step re-reveals that single cell with a
  left-to-right "pencil" animation.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup and layout |
| `styles.css` | Styling |
| `app.js` | All logic: image processing, grid analysis, instructions, animation |

No frameworks, no network calls, no tracking.
