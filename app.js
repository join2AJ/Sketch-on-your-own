/* ============================================================
   Sketch on Your Own
   Upload a photo -> grid-method, step-by-step drawing tutorial.
   100% client-side. No dependencies. No uploads.

   Highlights:
   - Face-aware edge detection: the face is found via skin-tone
     analysis and drawn with more detail + darker lines, while the
     busy background is decluttered with adaptive thresholding.
   - The complete sketch is shown at once; clicking any step
     re-draws just that grid cell with a highlight.
   ============================================================ */

(() => {
  "use strict";

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const uploadView = $("uploadView");
  const studioView = $("studioView");
  const dropZone = $("dropZone");
  const fileInput = $("fileInput");
  const pickBtn = $("pickBtn");
  const sampleRow = $("sampleRow");

  const gridSelect = $("gridSelect");
  const detailRange = $("detailRange");
  const speedSelect = $("speedSelect");
  const buildBtn = $("buildBtn");
  const newImageBtn = $("newImageBtn");

  const refCanvas = $("refCanvas");
  const drawCanvas = $("drawCanvas");
  const refCtx = refCanvas.getContext("2d");
  const drawCtx = drawCanvas.getContext("2d");

  const stepNum = $("stepNum");
  const stepTotal = $("stepTotal");
  const stepTitle = $("stepTitle");
  const stepText = $("stepText");
  const stepsOl = $("stepsOl");

  const prevBtn = $("prevBtn");
  const nextBtn = $("nextBtn");
  const playBtn = $("playBtn");
  const restartBtn = $("restartBtn");

  const helpBtn = $("helpBtn");
  const helpModal = $("helpModal");
  const helpClose = $("helpClose");

  // ---------- App state ----------
  const MAX_DIM = 720; // working / canvas resolution cap

  const state = {
    img: null,
    w: 0,
    h: 0,
    cols: 6,
    rows: 6,
    cellW: 0,
    cellH: 0,
    gray: null, // Float32Array luminance
    mag: null, // Sobel magnitude
    ang: null, // gradient angle
    normDenom: 1, // robust normalization denominator
    faceBox: null, // {x0,y0,x1,y1} or null
    edgeCanvas: null, // white bg + dark edge lines
    edgeMask: null, // Uint8Array: 1 where an edge line was drawn
    full: null, // offscreen canvas: white + ALL cells drawn (the finished sketch)
    cells: [],
    steps: [],
    current: 0,
    playing: false,
    speed: 1,
    detail: 0.45,
    raf: null,
    animToken: 0,
  };

  // ============================================================
  //  IMAGE INTAKE
  // ============================================================
  function loadImageFromSrc(src) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => startStudio(img);
    img.onerror = () => alert("Sorry, that image could not be loaded.");
    img.src = src;
  }

  function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      alert("Please choose an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => loadImageFromSrc(e.target.result);
    reader.readAsDataURL(file);
  }

  pickBtn.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("click", (e) => {
    if (e.target === pickBtn) return;
    fileInput.click();
  });
  fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

  ["dragenter", "dragover"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
    })
  );
  dropZone.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

  newImageBtn.addEventListener("click", () => {
    cancelAnim();
    state.playing = false;
    studioView.hidden = true;
    uploadView.hidden = false;
  });

  // ============================================================
  //  STUDIO SETUP
  // ============================================================
  function startStudio(img) {
    state.img = img;
    let { width, height } = img;
    const scale = Math.min(1, MAX_DIM / Math.max(width, height));
    state.w = Math.max(1, Math.round(width * scale));
    state.h = Math.max(1, Math.round(height * scale));

    [refCanvas, drawCanvas].forEach((c) => {
      c.width = state.w;
      c.height = state.h;
    });

    uploadView.hidden = true;
    studioView.hidden = false;

    processImage();
    buildEverything();
  }

  function processImage() {
    const off = document.createElement("canvas");
    off.width = state.w;
    off.height = state.h;
    const octx = off.getContext("2d", { willReadFrequently: true });
    octx.drawImage(state.img, 0, 0, state.w, state.h);
    const imgData = octx.getImageData(0, 0, state.w, state.h);
    const { data } = imgData;

    const n = state.w * state.h;
    const gray = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = data[i * 4],
        g = data[i * 4 + 1],
        b = data[i * 4 + 2];
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    state.gray = gray;
    state.srcCanvas = off;
    state.imgData = imgData;
  }

  // ---------- Small array helpers ----------
  // 3x3 box blur on a Float32 luminance buffer
  function blur3(src, w, h) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0,
          cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx,
              ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              sum += src[ny * w + nx];
              cnt++;
            }
          }
        }
        out[y * w + x] = sum / cnt;
      }
    }
    return out;
  }

  // Separable box blur (mean over a (2r+1) window) on a Float32 buffer
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const win = 2 * r + 1;
    // horizontal
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) acc += src[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / win;
        const add = src[row + clamp(x + r + 1, 0, w - 1)];
        const sub = src[row + clamp(x - r, 0, w - 1)];
        acc += add - sub;
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / win;
        const add = tmp[clamp(y + r + 1, 0, h - 1) * w + x];
        const sub = tmp[clamp(y - r, 0, h - 1) * w + x];
        acc += add - sub;
      }
    }
    return out;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // ============================================================
  //  EDGE DETECTION (Sobel + robust normalization)
  // ============================================================
  function computeEdges() {
    const w = state.w,
      h = state.h;
    const g = blur3(state.gray, w, h);
    const mag = new Float32Array(w * h);
    const ang = new Float32Array(w * h);
    let maxMag = 1e-6;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const tl = g[i - w - 1],
          tc = g[i - w],
          tr = g[i - w + 1];
        const ml = g[i - 1],
          mr = g[i + 1];
        const bl = g[i + w - 1],
          bc = g[i + w],
          br = g[i + w + 1];
        const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
        const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
        const m = Math.hypot(gx, gy);
        mag[i] = m;
        ang[i] = Math.atan2(gy, gx);
        if (m > maxMag) maxMag = m;
      }
    }

    // Robust normalization: use the ~96th percentile instead of the max,
    // so a few very strong background edges don't crush the face's edges.
    const bins = 256;
    const hist = new Uint32Array(bins);
    const n = w * h;
    for (let i = 0; i < n; i++) {
      const b = Math.min(bins - 1, ((mag[i] / maxMag) * (bins - 1)) | 0);
      hist[b]++;
    }
    let cum = 0;
    const target = n * 0.96;
    let normDenom = maxMag;
    for (let b = 0; b < bins; b++) {
      cum += hist[b];
      if (cum >= target) {
        normDenom = ((b + 1) / bins) * maxMag;
        break;
      }
    }

    state.mag = mag;
    state.ang = ang;
    state.normDenom = Math.max(normDenom, 1e-6);
  }

  // ============================================================
  //  FACE DETECTION (skin tone, YCbCr) -> bounding box
  //  No libraries, no network. Works across skin tones.
  // ============================================================
  function detectFaceBox() {
    const w = state.w,
      h = state.h;
    const { data } = state.imgData;

    // Coarse grid so we can find the dominant skin blob cheaply.
    const CG = 56; // coarse columns
    const cw = Math.max(1, Math.round(w / CG));
    const gw = Math.ceil(w / cw);
    const gh = Math.ceil(h / cw);
    const skinFrac = new Float32Array(gw * gh);
    const total = new Float32Array(gw * gh);

    for (let y = 0; y < h; y++) {
      const gy = (y / cw) | 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2];
        const Y = 0.299 * r + 0.587 * g + 0.114 * b;
        const Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        const isSkin =
          Y > 40 && Cr >= 135 && Cr <= 180 && Cb >= 85 && Cb <= 135;
        const gi = (x / cw | 0) + gx0(gy, gw);
        total[gi]++;
        if (isSkin) skinFrac[gi]++;
      }
    }
    function gx0(gy, gw) {
      return gy * gw;
    }
    for (let i = 0; i < skinFrac.length; i++) {
      skinFrac[i] = total[i] ? skinFrac[i] / total[i] : 0;
    }

    // Binary skin cells
    const skin = new Uint8Array(gw * gh);
    for (let i = 0; i < skin.length; i++) skin[i] = skinFrac[i] > 0.35 ? 1 : 0;

    // Connected components (4-conn), pick the best face-like blob.
    const seen = new Uint8Array(gw * gh);
    let best = null;
    const stack = [];
    for (let sy = 0; sy < gh; sy++) {
      for (let sx = 0; sx < gw; sx++) {
        const s0 = sy * gw + sx;
        if (!skin[s0] || seen[s0]) continue;
        // BFS
        stack.length = 0;
        stack.push(s0);
        seen[s0] = 1;
        let count = 0,
          minX = gw,
          minY = gh,
          maxX = 0,
          maxY = 0;
        while (stack.length) {
          const c = stack.pop();
          const cx = c % gw,
            cy = (c / gw) | 0;
          count++;
          if (cx < minX) minX = cx;
          if (cy < minY) minY = cy;
          if (cx > maxX) maxX = cx;
          if (cy > maxY) maxY = cy;
          const neigh = [c - 1, c + 1, c - gw, c + gw];
          if (cx === 0) neigh[0] = -1;
          if (cx === gw - 1) neigh[1] = -1;
          for (const nb of neigh) {
            if (nb >= 0 && nb < skin.length && skin[nb] && !seen[nb]) {
              seen[nb] = 1;
              stack.push(nb);
            }
          }
        }
        const bw = maxX - minX + 1,
          bh = maxY - minY + 1;
        const aspect = bw / bh;
        const centerYNorm = (minY + maxY) / 2 / gh;
        // Prefer larger blobs, higher up, with face-ish aspect ratio.
        if (count < gw * gh * 0.01) continue;
        if (aspect < 0.35 || aspect > 2.4) continue;
        const score = count * (1.25 - 0.5 * centerYNorm);
        if (!best || score > best.score) {
          best = { minX, minY, maxX, maxY, count, score, bw, bh };
        }
      }
    }

    if (!best) return null;

    // The blob may include neck + shoulders + a similarly-coloured shirt.
    // Size the FACE from skin in the UPPER part of the blob only (the head),
    // where the shirt hasn't widened it yet.
    const topCut = best.minY + Math.max(0, Math.round((best.maxY - best.minY) * 0.45));
    let sumX = 0,
      cnt = 0,
      hMinX = gw,
      hMaxX = 0;
    for (let cy = best.minY; cy <= topCut; cy++) {
      for (let cx = best.minX; cx <= best.maxX; cx++) {
        if (skin[cy * gw + cx]) {
          sumX += cx;
          cnt++;
          if (cx < hMinX) hMinX = cx;
          if (cx > hMaxX) hMaxX = cx;
        }
      }
    }
    if (cnt === 0) return null;

    const headWc = hMaxX - hMinX + 1; // head width in coarse cells
    const cxCenter = (sumX / cnt + 0.5) * cw; // head centre in pixels
    const topY = best.minY * cw;

    const hw = headWc * cw; // head width in px
    const hh = hw * 1.4; // heads are a bit taller than wide

    // Widen slightly for ears/hair; extend up for hairline, down for chin.
    let x0 = cxCenter - hw * 0.72;
    let x1 = cxCenter + hw * 0.72;
    let y0 = topY - hh * 0.15;
    let y1 = y0 + hh * 1.25;

    x0 = Math.max(0, x0);
    x1 = Math.min(w, x1);
    y0 = Math.max(0, y0);
    y1 = Math.min(h, y1);

    // Guard against a degenerate/huge box.
    if (x1 - x0 < w * 0.06 || y1 - y0 < h * 0.06) return null;

    return { x0: x0 | 0, y0: y0 | 0, x1: x1 | 0, y1: y1 | 0 };
  }

  const inBox = (box, x, y) =>
    box && x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1;

  // ============================================================
  //  RENDER EDGE MAP  (face-aware + adaptive thresholding)
  // ============================================================
  function renderEdgeCanvas() {
    const w = state.w,
      h = state.h,
      n = w * h;
    const mag = state.mag,
      normDenom = state.normDenom;
    const box = state.faceBox;

    // normalized magnitude
    const norm = new Float32Array(n);
    for (let i = 0; i < n; i++) norm[i] = Math.min(1, mag[i] / normDenom);

    // local mean of edge energy -> lets us suppress busy/textured areas
    const r = Math.max(4, Math.round(Math.min(w, h) / 45));
    const localMean = boxBlur(norm, w, h, r);

    // detail slider: higher = more lines (lower background threshold)
    const detail = state.detail; // 0..1
    const thrBg = 0.27 - detail * 0.15; // ~[0.12 .. 0.27]  (busy bg -> fewer lines)
    const thrFace = thrBg * 0.38; // face is far more sensitive
    const floor = 0.03;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const out = ctx.createImageData(w, h);
    const d = out.data;
    const mask = new Uint8Array(n);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const nm = norm[i];
        const face = inBox(box, x, y);
        const base = face ? thrFace : thrBg;
        // adaptive term: in busy regions, require a stronger edge.
        // dialed WAY down inside the face so subtle features survive.
        const adaptive = (face ? 0.3 : 1.55) * localMean[i];
        const thr = Math.max(base, adaptive, floor);

        let v = 255;
        if (nm > thr) {
          mask[i] = 1;
          const strength = clamp((nm - thr) / (1 - thr), 0, 1);
          v = Math.round(30 + 95 * (1 - Math.pow(strength, 0.6))); // 30..125
          if (face) v = Math.round(v * 0.62); // darker, crisper face lines
        }
        d[i * 4] = v;
        d[i * 4 + 1] = v;
        d[i * 4 + 2] = v;
        d[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    state.edgeCanvas = canvas;
    state.edgeMask = mask;
  }

  // ============================================================
  //  GRID + CELL ANALYSIS
  // ============================================================
  function buildGrid() {
    state.cols = parseInt(gridSelect.value, 10);
    const targetCell = state.w / state.cols;
    state.rows = Math.max(1, Math.round(state.h / targetCell));
    state.cellW = state.w / state.cols;
    state.cellH = state.h / state.rows;
  }

  const colLabel = (c) => {
    let s = "";
    c += 1;
    while (c > 0) {
      const rem = (c - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      c = Math.floor((c - 1) / 26);
    }
    return s;
  };

  function analyzeCells() {
    const w = state.w;
    const mask = state.edgeMask;
    const cells = [];

    for (let row = 0; row < state.rows; row++) {
      for (let col = 0; col < state.cols; col++) {
        const x0 = Math.round(col * state.cellW);
        const y0 = Math.round(row * state.cellH);
        const x1 = Math.round((col + 1) * state.cellW);
        const y1 = Math.round((row + 1) * state.cellH);

        let brightSum = 0,
          px = 0,
          edgePx = 0,
          faceHits = 0;
        const orient = [0, 0, 0, 0];

        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = y * w + x;
            brightSum += state.gray[i];
            px++;
            if (inBox(state.faceBox, x, y)) faceHits++;
            if (mask[i]) {
              edgePx++;
              let a = state.ang[i] + Math.PI / 2; // edge dir _|_ gradient
              a = ((a % Math.PI) + Math.PI) % Math.PI;
              const deg = (a * 180) / Math.PI;
              let bin;
              if (deg < 22.5 || deg >= 157.5) bin = 0;
              else if (deg < 67.5) bin = 1;
              else if (deg < 112.5) bin = 2;
              else bin = 3;
              orient[bin] += state.mag[i] / state.normDenom;
            }
          }
        }

        const brightness = px ? brightSum / px : 255;
        const density = px ? edgePx / px : 0;
        let dom = 0;
        for (let k = 1; k < 4; k++) if (orient[k] > orient[dom]) dom = k;

        cells.push({
          row,
          col,
          label: colLabel(col) + (row + 1),
          x0,
          y0,
          x1,
          y1,
          brightness,
          density,
          orient: dom,
          hasContent: density > 0.01,
          inFace: px && faceHits / px > 0.35,
        });
      }
    }
    state.cells = cells;
  }

  // ---- Instruction text ----
  const ORIENT_WORDS = [
    "mostly horizontal",
    "diagonal (bottom-left to top-right)",
    "mostly vertical",
    "diagonal (top-left to bottom-right)",
  ];

  function brightnessWord(b) {
    if (b > 205) return { tone: "very light", note: "faint, soft marks only" };
    if (b > 165) return { tone: "light", note: "light, soft pencil pressure" };
    if (b > 110) return { tone: "medium", note: "medium pressure and gentle shading" };
    if (b > 60) return { tone: "dark", note: "press firmer and shade it in" };
    return { tone: "very dark", note: "shade heavily — one of the darkest areas" };
  }

  function densityWord(d) {
    if (d < 0.01) return "empty";
    if (d < 0.05) return "a few";
    if (d < 0.14) return "several";
    return "many";
  }

  function cellInstruction(cell) {
    const b = brightnessWord(cell.brightness);
    const facePrefix = cell.inFace ? "👤 Face — take your time here. " : "";

    if (!cell.hasContent) {
      if (cell.brightness < 110) {
        return `Cell ${cell.label}: ${facePrefix}no outlines, but it's a solid ${b.tone} area — shade it evenly and fairly dark, edge to edge.`;
      }
      if (cell.brightness < 165) {
        return `Cell ${cell.label}: ${facePrefix}no real lines — lay down smooth, even ${b.tone} shading across the cell.`;
      }
      return `Cell ${cell.label}: ${facePrefix}almost nothing here — leave it blank, or add only a whisper of light shading.`;
    }

    const many = densityWord(cell.density);
    const dir = ORIENT_WORDS[cell.orient];
    return `Cell ${cell.label}: ${facePrefix}draw ${many} ${dir} lines. This area is ${b.tone} — ${b.note}.`;
  }

  // ============================================================
  //  STEPS
  // ============================================================
  function buildSteps() {
    const steps = [];
    steps.push({
      type: "grid",
      title: "Overview · Set up your grid",
      text: `Lightly draw a grid on your paper: ${state.cols} columns (A–${colLabel(
        state.cols - 1
      )}) and ${state.rows} rows (1–${state.rows}). The full sketch is shown on the right — click any step below to watch that cell being drawn.`,
    });
    state.cells.forEach((cell) => {
      steps.push({
        type: "cell",
        cell,
        title: cell.inFace ? `Cell ${cell.label} · Face` : `Cell ${cell.label}`,
        text: cellInstruction(cell),
      });
    });
    steps.push({
      type: "finish",
      title: "Final step · Clean up",
      text: "Erase your grid lines, darken the strongest outlines, and deepen the darkest shadows. Step back — you've drawn the photo. 🎉",
    });
    state.steps = steps;
    state.current = 0;
  }

  const stripLabel = (t) => t.replace(/^Cell\s+\S+:\s*/, "");

  function buildStepsList() {
    stepsOl.innerHTML = "";
    state.steps.forEach((s, idx) => {
      const li = document.createElement("li");
      if (s.type === "cell") {
        li.innerHTML = `<span class="cell-tag">${s.cell.label}</span>${stripLabel(
          s.text
        )}`;
        if (s.cell.inFace) li.classList.add("face-step");
      } else {
        li.textContent = s.text;
      }
      li.addEventListener("click", () => showStep(idx, true));
      stepsOl.appendChild(li);
    });
  }

  // ============================================================
  //  BUILD
  // ============================================================
  function buildEverything() {
    state.detail = detailRange.value / 100;
    state.speed = parseFloat(speedSelect.value);

    computeEdges();
    state.faceBox = detectFaceBox();
    renderEdgeCanvas();
    buildGrid();
    analyzeCells();
    buildSteps();
    buildStepsList();
    buildFull();

    stepTotal.textContent = state.steps.length;
    showStep(0, false);
  }

  // Detail changed: re-threshold + re-analyze (keeps grid & face box)
  function rebuildDetail() {
    state.detail = detailRange.value / 100;
    renderEdgeCanvas();
    analyzeCells();
    buildSteps();
    buildStepsList();
    buildFull();
    showStep(0, false);
  }

  // The finished sketch: white paper + every cell's edges baked in.
  function buildFull() {
    const c = document.createElement("canvas");
    c.width = state.w;
    c.height = state.h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, state.w, state.h);
    ctx.drawImage(state.edgeCanvas, 0, 0);
    state.full = c;
  }

  gridSelect.addEventListener("change", buildEverything);
  detailRange.addEventListener("change", rebuildDetail);
  speedSelect.addEventListener("change", () => {
    state.speed = parseFloat(speedSelect.value);
  });

  // ============================================================
  //  DRAWING PRIMITIVES
  // ============================================================
  function drawGrid(ctx, progress = 1, faded = false) {
    ctx.save();
    ctx.strokeStyle = faded ? "rgba(120,140,200,0.16)" : "rgba(90,110,170,0.4)";
    ctx.lineWidth = 1;
    const totalLines = state.cols - 1 + (state.rows - 1) + 2;
    const linesToDraw = Math.ceil(totalLines * progress);
    let drawn = 0;
    ctx.strokeRect(0.5, 0.5, state.w - 1, state.h - 1);
    drawn += 2;
    for (let c = 1; c < state.cols && drawn < linesToDraw; c++) {
      const x = Math.round(c * state.cellW) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, state.h);
      ctx.stroke();
      drawn++;
    }
    for (let r = 1; r < state.rows && drawn < linesToDraw; r++) {
      const y = Math.round(r * state.cellH) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(state.w, y);
      ctx.stroke();
      drawn++;
    }
    ctx.restore();
  }

  function drawGridLabels(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `${Math.max(10, Math.round(state.cellW * 0.22))}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let c = 0; c < state.cols; c++) {
      ctx.fillText(colLabel(c), (c + 0.5) * state.cellW, 3);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let r = 0; r < state.rows; r++) {
      ctx.fillText(String(r + 1), 3, (r + 0.5) * state.cellH);
    }
    ctx.restore();
  }

  function cellHighlight(ctx, cell, strong = true) {
    ctx.save();
    ctx.fillStyle = strong ? "rgba(255,179,71,0.16)" : "rgba(255,179,71,0.08)";
    ctx.strokeStyle = "rgba(255,179,71,0.95)";
    ctx.lineWidth = 3;
    const { x0, y0, x1, y1 } = cell;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeRect(x0 + 1.5, y0 + 1.5, x1 - x0 - 3, y1 - y0 - 3);
    ctx.restore();
  }

  // Reference photo + grid + labels + face box + active-cell highlight
  function renderReference(activeCell) {
    refCtx.clearRect(0, 0, state.w, state.h);
    refCtx.drawImage(state.srcCanvas, 0, 0);
    drawGrid(refCtx, 1, false);
    drawGridLabels(refCtx);

    if (state.faceBox) {
      const b = state.faceBox;
      refCtx.save();
      refCtx.strokeStyle = "rgba(110,168,254,0.9)";
      refCtx.setLineDash([7, 5]);
      refCtx.lineWidth = 2;
      refCtx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      refCtx.restore();
    }
    if (activeCell) cellHighlight(refCtx, activeCell, true);
  }

  // The full finished sketch (base layer shown at all times)
  function renderComplete(gridProgress = 1, faded = false) {
    drawCtx.clearRect(0, 0, state.w, state.h);
    drawCtx.drawImage(state.full, 0, 0);
    drawGrid(drawCtx, gridProgress, faded);
  }

  // ============================================================
  //  STEP DISPLAY  (full sketch shown; selected cell re-drawn)
  // ============================================================
  function cancelAnim() {
    state.animToken++;
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = null;
    }
  }

  function updateInstructionUI(step, index) {
    stepNum.textContent = index + 1;
    stepTitle.textContent = step.title;
    stepText.textContent = step.text;
    [...stepsOl.children].forEach((li, i) => {
      li.classList.toggle("active", i === index);
    });
    const activeLi = stepsOl.children[index];
    if (activeLi) activeLi.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function showStep(index, animate = true) {
    cancelAnim();
    index = Math.max(0, Math.min(state.steps.length - 1, index));
    state.current = index;
    const step = state.steps[index];

    updateInstructionUI(step, index);
    renderReference(step.type === "cell" ? step.cell : null);

    if (step.type === "grid") {
      if (animate) animateGrid();
      else renderComplete(1, false);
    } else if (step.type === "finish") {
      renderComplete(1, true);
    } else {
      if (animate) animateCell(step.cell);
      else {
        renderComplete(1, false);
        cellHighlight(drawCtx, step.cell, true);
      }
    }
  }

  // Animate the grid being drawn over the finished sketch
  function animateGrid() {
    const token = state.animToken;
    const duration = 1400 / state.speed;
    const start = performance.now();
    const tick = (now) => {
      if (token !== state.animToken) return;
      const p = Math.min(1, (now - start) / duration);
      renderComplete(p, false);
      if (p < 1) state.raf = requestAnimationFrame(tick);
      else state.raf = null;
    };
    state.raf = requestAnimationFrame(tick);
  }

  // Re-draw ONE cell on top of the finished sketch, with a pencil trace.
  // Returns via callback when done (used by "watch it drawn" tour).
  function animateCell(cell, onDone) {
    const token = state.animToken;
    const duration = 950 / state.speed;
    const start = performance.now();
    const cw = cell.x1 - cell.x0,
      ch = cell.y1 - cell.y0;

    const tick = (now) => {
      if (token !== state.animToken) return;
      const p = Math.min(1, (now - start) / duration);

      renderComplete(1, false); // full sketch base

      // "Freshly draw" this cell: white it out, reveal edges left->right
      const rw = Math.round(cw * p);
      drawCtx.save();
      drawCtx.fillStyle = "#fff";
      drawCtx.fillRect(cell.x0, cell.y0, cw, ch);
      if (rw > 0) {
        drawCtx.drawImage(
          state.edgeCanvas,
          cell.x0,
          cell.y0,
          rw,
          ch,
          cell.x0,
          cell.y0,
          rw,
          ch
        );
      }
      drawCtx.restore();

      drawGrid(drawCtx, 1, false); // restore grid lines over the cell
      cellHighlight(drawCtx, cell, true);

      if (p < 1) {
        // pencil at the reveal frontier
        drawCtx.save();
        drawCtx.font = `${Math.round(ch * 0.5)}px serif`;
        drawCtx.textAlign = "center";
        drawCtx.textBaseline = "middle";
        drawCtx.fillText("✏️", cell.x0 + rw, cell.y0 + ch * 0.5);
        drawCtx.restore();
        state.raf = requestAnimationFrame(tick);
      } else {
        state.raf = null;
        if (onDone) onDone();
      }
    };
    state.raf = requestAnimationFrame(tick);
  }

  // ============================================================
  //  "WATCH IT DRAWN"  (progressive build from blank paper)
  // ============================================================
  function watchFullBuild() {
    cancelAnim();
    state.playing = false;
    setPlayIcon();
    const token = state.animToken;

    // Blank paper + grid
    const acc = document.createElement("canvas");
    acc.width = state.w;
    acc.height = state.h;
    const actx = acc.getContext("2d");
    actx.fillStyle = "#fff";
    actx.fillRect(0, 0, state.w, state.h);

    const cells = state.cells;
    let idx = 0;

    const drawFrame = (cell, p) => {
      drawCtx.clearRect(0, 0, state.w, state.h);
      drawCtx.drawImage(acc, 0, 0);
      // current cell revealing
      if (cell) {
        const cw = cell.x1 - cell.x0,
          ch = cell.y1 - cell.y0;
        const rw = Math.round(cw * p);
        if (rw > 0) {
          drawCtx.drawImage(
            state.edgeCanvas,
            cell.x0,
            cell.y0,
            rw,
            ch,
            cell.x0,
            cell.y0,
            rw,
            ch
          );
        }
        drawGrid(drawCtx, 1, false);
        if (p < 1) {
          drawCtx.save();
          drawCtx.font = `${Math.round(ch * 0.5)}px serif`;
          drawCtx.textAlign = "center";
          drawCtx.textBaseline = "middle";
          drawCtx.fillText("✏️", cell.x0 + rw, cell.y0 + ch * 0.5);
          drawCtx.restore();
        }
      } else {
        drawGrid(drawCtx, 1, false);
      }
    };

    const dur = 260 / state.speed;
    const runCell = () => {
      if (token !== state.animToken) return;
      if (idx >= cells.length) {
        renderComplete(1, false);
        showStep(state.steps.length - 1, false);
        return;
      }
      const cell = cells[idx];
      renderReference(cell);
      updateInstructionUI(state.steps[idx + 1], idx + 1);
      const start = performance.now();
      const tick = (now) => {
        if (token !== state.animToken) return;
        const p = Math.min(1, (now - start) / dur);
        drawFrame(cell, p);
        if (p < 1) {
          state.raf = requestAnimationFrame(tick);
        } else {
          // bake cell into accumulator
          actx.drawImage(
            state.edgeCanvas,
            cell.x0,
            cell.y0,
            cell.x1 - cell.x0,
            cell.y1 - cell.y0,
            cell.x0,
            cell.y0,
            cell.x1 - cell.x0,
            cell.y1 - cell.y0
          );
          idx++;
          state.raf = requestAnimationFrame(runCell);
        }
      };
      state.raf = requestAnimationFrame(tick);
    };
    runCell();
  }

  buildBtn.addEventListener("click", watchFullBuild);

  // ============================================================
  //  GUIDED TOUR (play = step through highlighting each cell)
  // ============================================================
  function setPlayIcon() {
    playBtn.textContent = state.playing ? "⏸" : "▶";
  }

  function playTour() {
    function runCurrentInTour() {
      const t2 = state.animToken;
      const s = state.steps[state.current];
      updateInstructionUI(s, state.current);
      renderReference(s.type === "cell" ? s.cell : null);
      if (s.type === "cell") {
        animateCell(s.cell, () => {
          if (t2 === state.animToken) afterStepStatic();
        });
      } else if (s.type === "grid") {
        renderComplete(1, false);
        setTimeout(afterStepStatic, 500 / state.speed);
      } else {
        renderComplete(1, true);
        state.playing = false;
        setPlayIcon();
      }
    }

    function afterStepStatic() {
      if (!state.playing) return;
      if (state.current >= state.steps.length - 1) {
        state.playing = false;
        setPlayIcon();
        return;
      }
      state.current++;
      runCurrentInTour();
    }

    runCurrentInTour();
  }

  playBtn.addEventListener("click", () => {
    if (state.playing) {
      state.playing = false;
      cancelAnim();
      setPlayIcon();
      showStep(state.current, false);
    } else {
      state.playing = true;
      setPlayIcon();
      if (state.current >= state.steps.length - 1) state.current = 0;
      cancelAnim();
      playTour();
    }
  });

  nextBtn.addEventListener("click", () => {
    state.playing = false;
    setPlayIcon();
    showStep(state.current + 1, true);
  });
  prevBtn.addEventListener("click", () => {
    state.playing = false;
    setPlayIcon();
    showStep(state.current - 1, true);
  });
  restartBtn.addEventListener("click", () => {
    state.playing = false;
    setPlayIcon();
    showStep(0, true);
  });

  document.addEventListener("keydown", (e) => {
    if (studioView.hidden) return;
    if (e.key === "ArrowRight") nextBtn.click();
    else if (e.key === "ArrowLeft") prevBtn.click();
    else if (e.key === " ") {
      e.preventDefault();
      playBtn.click();
    }
  });

  // ---------- Help modal ----------
  helpBtn.addEventListener("click", () => (helpModal.hidden = false));
  helpClose.addEventListener("click", () => (helpModal.hidden = true));
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) helpModal.hidden = true;
  });

  // ============================================================
  //  SAMPLE IMAGES (drawn on a canvas, so no network needed)
  // ============================================================
  function makeSample(drawFn, w = 240, h = 240) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    drawFn(c.getContext("2d"), w, h);
    return c;
  }

  const samples = [
    (ctx, w, h) => {
      ctx.fillStyle = "#dfeaf2";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#f0c9a0";
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.52, w * 0.26, h * 0.33, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#7a4a2a";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(w * 0.34, h * 0.42);
      ctx.quadraticCurveTo(w * 0.4, h * 0.38, w * 0.46, h * 0.42);
      ctx.moveTo(w * 0.54, h * 0.42);
      ctx.quadraticCurveTo(w * 0.6, h * 0.38, w * 0.66, h * 0.42);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(w * 0.4, h * 0.48, 13, 8, 0, 0, Math.PI * 2);
      ctx.ellipse(w * 0.6, h * 0.48, 13, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3a2a1a";
      ctx.beginPath();
      ctx.arc(w * 0.4, h * 0.48, 4.5, 0, Math.PI * 2);
      ctx.arc(w * 0.6, h * 0.48, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#5a3b25";
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.5);
      ctx.lineTo(w * 0.47, h * 0.6);
      ctx.lineTo(w * 0.53, h * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.64, w * 0.1, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = "#3a2a1a";
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.36, w * 0.27, Math.PI, 0);
      ctx.fill();
    },
    (ctx, w, h) => {
      ctx.fillStyle = "#cfe6f5";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#8fca6b";
      ctx.fillRect(0, h * 0.66, w, h * 0.34);
      ctx.fillStyle = "#f7d774";
      ctx.beginPath();
      ctx.arc(w * 0.78, h * 0.22, w * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e8a87c";
      ctx.fillRect(w * 0.28, h * 0.42, w * 0.36, h * 0.28);
      ctx.fillStyle = "#b5533b";
      ctx.beginPath();
      ctx.moveTo(w * 0.24, h * 0.42);
      ctx.lineTo(w * 0.46, h * 0.24);
      ctx.lineTo(w * 0.68, h * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#5a3b25";
      ctx.fillRect(w * 0.42, h * 0.54, w * 0.1, h * 0.16);
      ctx.fillStyle = "#bfe3f7";
      ctx.fillRect(w * 0.31, h * 0.47, w * 0.08, h * 0.08);
    },
    (ctx, w, h) => {
      ctx.fillStyle = "#efe7db";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#d94b3a";
      ctx.beginPath();
      ctx.arc(w * 0.45, h * 0.56, w * 0.22, 0, Math.PI * 2);
      ctx.arc(w * 0.58, h * 0.56, w * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5a3b1a";
      ctx.fillRect(w * 0.5, h * 0.3, 5, h * 0.14);
      ctx.fillStyle = "#4e9d3a";
      ctx.beginPath();
      ctx.ellipse(w * 0.57, h * 0.34, 16, 8, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(w * 0.38, h * 0.48, w * 0.08, 1.1 * Math.PI, 1.5 * Math.PI);
      ctx.stroke();
    },
  ];

  function buildSamples() {
    samples.forEach((fn) => {
      const full = makeSample(fn);
      const btn = document.createElement("button");
      btn.className = "sample-thumb";
      btn.appendChild(makeSample(fn, 92, 92));
      btn.addEventListener("click", () => loadImageFromSrc(full.toDataURL()));
      sampleRow.appendChild(btn);
    });
  }

  buildSamples();

  // Debug hook (read-only) — handy for automated checks; harmless in prod.
  window.__sketch = { state };
})();
