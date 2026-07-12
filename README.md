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
4. It then acts like an **instructor**, going cell by cell:
   - A **written instruction** tells you what to draw in that cell (how many lines, their
     direction, how light/dark to shade).
   - A **visual animation** draws those exact lines on a blank canvas, so you can copy them.
5. At the end, you **erase the grid** — and you've drawn the photo.

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
- Edges are thresholded and rendered as clean black lines on white (the "sketch").
- The grid is overlaid, and each cell is analyzed for **brightness**, **edge density**, and
  **dominant line orientation** — which is turned into a plain-English instruction.
- Each cell's lines are revealed with a left-to-right "pencil" animation, accumulating into the
  finished drawing.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup and layout |
| `styles.css` | Styling |
| `app.js` | All logic: image processing, grid analysis, instructions, animation |

No frameworks, no network calls, no tracking.
