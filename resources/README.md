# Research & Resources

Notes gathered while designing **Sketch on Your Own**, so the app's behaviour is
grounded in real drawing pedagogy and real image-processing techniques instead of
guesswork.

| File | What's inside |
|------|---------------|
| [`sketching-methodologies.md`](./sketching-methodologies.md) | How people are actually taught to draw: the grid method, the Loomis method, block-in, construction/proportion lines, and shading stages. |
| [`facial-features.md`](./facial-features.md) | How to draw each feature — eyes, eyebrows, nose, lips/mouth, ears — plus the proportions that place them. Drives the face rendering and the feature-specific instructions. |
| [`photo-to-lineart-algorithms.md`](./photo-to-lineart-algorithms.md) | How to turn a photo into clean sketch lines: Sobel vs. Difference-of-Gaussians vs. **XDoG** vs. Canny, with formulas and parameters. Explains *why we switched away from Sobel*. |
| [`user-research.md`](./user-research.md) | What beginners want and struggle with in drawing tutorials, and the concrete product decisions that came out of it. |

Each file lists its sources at the bottom.

## TL;DR — how the research changed the app

1. **Clean lines, not a photocopy.** Raw Sobel edge detection traced every skin
   pore, shadow and bit of texture, so faces came out as a muddy scribble. We
   moved to **XDoG**, whose base blur skips fine texture and produces smooth,
   connected contour lines that look hand-drawn.
2. **Teach like a real instructor: stage the drawing.** Instead of only marching
   through grid cells, the tutorial now follows the professional order:
   **block-in the big shapes → lay down proportion/construction guides →
   refine detail cell by cell → add shading last.**
3. **Face first, and proportion guides for portraits.** When a face is detected we
   draw Loomis-style proportion guides (center axis, brow/eye/nose/mouth lines)
   and draw the face cells before the background — because the face is the point.
4. **Don't overwhelm; encourage.** Steps are grouped into named phases, kept
   short, and written in plain, supportive language.
