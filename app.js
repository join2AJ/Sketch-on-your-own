/* ============================================================
   Sketch on Your Own
   Upload a photo -> a staged, grid-method drawing tutorial.
   100% client-side. No dependencies. No uploads.

   Pipeline (see /resources for the research behind these choices):
   - XDoG (eXtended Difference-of-Gaussians) turns the photo into clean,
     thin, hand-drawn-looking lines instead of a noisy Sobel "photocopy".
     The base blur (sigma) skips skin texture/pores, so faces stay clean.
   - Skin-tone (YCbCr) face detection -> Loomis proportion guides + the
     face is drawn first.
   - The lesson is staged like a real instructor teaches:
     Block-in -> Proportion guides -> Detail (grid) -> Shading -> Finish.
   ============================================================ */

(() => {
  "use strict";

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
  const phaseTag = $("phaseTag");
  const stepsOl = $("stepsOl");

  const prevBtn = $("prevBtn");
  const nextBtn = $("nextBtn");
  const playBtn = $("playBtn");
  const restartBtn = $("restartBtn");

  const helpBtn = $("helpBtn");
  const helpModal = $("helpModal");
  const helpClose = $("helpClose");

  const MAX_DIM = 720;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  const state = {
    img: null,
    w: 0,
    h: 0,
    cols: 6,
    rows: 6,
    cellW: 0,
    cellH: 0,
    gray: null,
    ang: null,
    faceBox: null,
    guides: null,
    features: [],
    edgeCanvas: null, // detailed clean line art (white + dark lines)
    edgeMask: null, // Uint8: ink pixels (for cell analysis)
    blockCanvas: null, // bold block-in outline (big shapes only)
    shadeCanvas: null, // hatching, only over dark areas
    full: null, // white paper + detailed line art (the finished line drawing)
    cells: [],
    orderedCells: [], // face-first order used by the tutorial
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
  //  SETUP
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
      gray[i] =
        0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }
    state.gray = gray;
    state.srcCanvas = off;
    state.imgData = imgData;
  }

  // ---------- Separable Gaussian blur on a Float32 buffer ----------
  function gaussianBlur(src, w, h, sigma) {
    if (sigma <= 0.01) return src.slice();
    const r = Math.max(1, Math.ceil(sigma * 3));
    const k = new Float32Array(2 * r + 1);
    let sum = 0;
    for (let i = -r; i <= r; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      k[i + r] = v;
      sum += v;
    }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let i = -r; i <= r; i++)
          acc += src[row + clamp(x + i, 0, w - 1)] * k[i + r];
        tmp[row + x] = acc;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let acc = 0;
        for (let i = -r; i <= r; i++)
          acc += tmp[clamp(y + i, 0, h - 1) * w + x] * k[i + r];
        out[y * w + x] = acc;
      }
    }
    return out;
  }

  // ---------- XDoG: clean stylised line drawing ----------
  // Returns Float32 in [0,1]; 1 = white paper, 0 = solid ink.
  function xdog(gray01, w, h, { sigma, k, tau, phi, eps }) {
    const g1 = gaussianBlur(gray01, w, h, sigma);
    const g2 = gaussianBlur(gray01, w, h, sigma * k);
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const D = g1[i] - tau * g2[i];
      out[i] = D >= eps ? 1 : 1 + Math.tanh(phi * (D - eps));
    }
    return out;
  }

  // ---------- Gradient direction (for per-cell line-orientation hints) ----------
  function computeGradient() {
    const w = state.w,
      h = state.h;
    const g = gaussianBlur(state.gray, w, h, 1.2);
    const ang = new Float32Array(w * h);
    const mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx =
          g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] -
          (g[i - w - 1] + 2 * g[i - 1] + g[i + w - 1]);
        const gy =
          g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] -
          (g[i - w - 1] + 2 * g[i - w] + g[i - w + 1]);
        ang[i] = Math.atan2(gy, gx);
        mag[i] = Math.hypot(gx, gy);
      }
    }
    state.ang = ang;
    state.mag = mag;
  }

  // ============================================================
  //  FACE DETECTION (skin tone, YCbCr) -> head-focused box
  // ============================================================
  function detectFaceBox() {
    const w = state.w,
      h = state.h;
    const { data } = state.imgData;
    const cw = Math.max(1, Math.round(w / 56));
    const gw = Math.ceil(w / cw);
    const gh = Math.ceil(h / cw);
    const skinCnt = new Float32Array(gw * gh);
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
        const isSkin = Y > 40 && Cr >= 135 && Cr <= 180 && Cb >= 85 && Cb <= 135;
        const gi = ((x / cw) | 0) + gy * gw;
        total[gi]++;
        if (isSkin) skinCnt[gi]++;
      }
    }
    const skin = new Uint8Array(gw * gh);
    for (let i = 0; i < skin.length; i++)
      skin[i] = total[i] && skinCnt[i] / total[i] > 0.35 ? 1 : 0;

    // largest face-like connected blob
    const seen = new Uint8Array(gw * gh);
    let best = null;
    const stack = [];
    for (let s0 = 0; s0 < skin.length; s0++) {
      if (!skin[s0] || seen[s0]) continue;
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
        const nb = [
          cx > 0 ? c - 1 : -1,
          cx < gw - 1 ? c + 1 : -1,
          c - gw,
          c + gw,
        ];
        for (const t of nb)
          if (t >= 0 && t < skin.length && skin[t] && !seen[t]) {
            seen[t] = 1;
            stack.push(t);
          }
      }
      const aspect = (maxX - minX + 1) / (maxY - minY + 1);
      if (count < gw * gh * 0.01) continue;
      if (aspect < 0.35 || aspect > 2.4) continue;
      const centerYNorm = (minY + maxY) / 2 / gh;
      const score = count * (1.25 - 0.5 * centerYNorm);
      if (!best || score > best.score) best = { minX, minY, maxX, maxY, score };
    }
    if (!best) return null;

    // Size the head from skin in the UPPER 45% of the blob (before the
    // neck/shirt widens it), so the box hugs the FACE.
    const topCut = best.minY + Math.round((best.maxY - best.minY) * 0.45);
    let sumX = 0,
      cnt = 0,
      hMinX = gw,
      hMaxX = 0;
    for (let cy = best.minY; cy <= topCut; cy++)
      for (let cx = best.minX; cx <= best.maxX; cx++)
        if (skin[cy * gw + cx]) {
          sumX += cx;
          cnt++;
          if (cx < hMinX) hMinX = cx;
          if (cx > hMaxX) hMaxX = cx;
        }
    if (!cnt) return null;

    const hw = (hMaxX - hMinX + 1) * cw;
    const hh = hw * 1.4;
    const cx = (sumX / cnt + 0.5) * cw;
    const topY = best.minY * cw;
    let x0 = cx - hw * 0.72,
      x1 = cx + hw * 0.72;
    let y0 = topY - hh * 0.15,
      y1 = y0 + hh * 1.25;
    x0 = clamp(x0, 0, w);
    x1 = clamp(x1, 0, w);
    y0 = clamp(y0, 0, h);
    y1 = clamp(y1, 0, h);
    if (x1 - x0 < w * 0.06 || y1 - y0 < h * 0.06) return null;
    return { x0: x0 | 0, y0: y0 | 0, x1: x1 | 0, y1: y1 | 0 };
  }

  const inBox = (box, x, y) =>
    box && x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1;

  // Facial feature regions, placed by Loomis proportions, each with a
  // beginner drawing tip (see resources/facial-features.md).
  function computeFeatures(box) {
    if (!box) return [];
    const bw = box.x1 - box.x0,
      bh = box.y1 - box.y0,
      cx = (box.x0 + box.x1) / 2;
    const eyeY = box.y0 + 0.5 * bh;
    const browY = box.y0 + 0.4 * bh;
    const noseY = box.y0 + 0.64 * bh;
    const mouthY = box.y0 + 0.83 * bh;
    const eyeDX = bw * 0.19;
    const box2 = ( cxx, cyy, hw, hh, type, label, tip) => ({
      type,
      label,
      tip,
      x0: cxx - hw,
      y0: cyy - hh,
      x1: cxx + hw,
      y1: cyy + hh,
    });
    return [
      box2(cx - eyeDX, eyeY, bw * 0.12, bh * 0.06, "eye", "eye",
        "👁️ Eye: draw the almond shape (corners slightly pointed), a circle for the iris and a dark pupil — and leave a tiny white highlight. Darken just under the upper lid."),
      box2(cx + eyeDX, eyeY, bw * 0.12, bh * 0.06, "eye", "eye",
        "👁️ Eye: draw the almond shape (corners slightly pointed), a circle for the iris and a dark pupil — and leave a tiny white highlight. Darken just under the upper lid."),
      box2(cx - eyeDX, browY, bw * 0.13, bh * 0.04, "brow", "eyebrow",
        "〰️ Eyebrow: a soft band of short strokes along the brow line, a little darker at the inner end."),
      box2(cx + eyeDX, browY, bw * 0.13, bh * 0.04, "brow", "eyebrow",
        "〰️ Eyebrow: a soft band of short strokes along the brow line, a little darker at the inner end."),
      box2(cx, noseY, bw * 0.13, bh * 0.13, "nose", "nose",
        "👃 Nose: keep outlines light — suggest the rounded tip and two soft nostril shadows, and shade the sides. Its width matches the inner eye corners."),
      box2(cx, mouthY, bw * 0.22, bh * 0.06, "mouth", "lips",
        "👄 Lips: the line where the lips meet is the darkest. Upper lip is thinner (a soft 'M' / cupid's bow); the lower lip is fuller and catches light, so keep a highlight. Darken the corners."),
      box2(box.x0 + bw * 0.03, eyeY + bh * 0.05, bw * 0.06, bh * 0.12, "ear", "ear",
        "👂 Ear: a 'C' shape with a fold inside; it runs from about the brow line down to the nose line."),
      box2(box.x1 - bw * 0.03, eyeY + bh * 0.05, bw * 0.06, bh * 0.12, "ear", "ear",
        "👂 Ear: a 'C' shape with a fold inside; it runs from about the brow line down to the nose line."),
    ];
  }

  function featureAt(x, y) {
    for (const f of state.features)
      if (x >= f.x0 && x < f.x1 && y >= f.y0 && y < f.y1) return f;
    return null;
  }

  // Loomis-style facial proportion guides from the face box
  function computeGuides(box) {
    if (!box) return null;
    const bh = box.y1 - box.y0;
    const cx = (box.x0 + box.x1) / 2;
    return {
      cx,
      x0: box.x0,
      x1: box.x1,
      y0: box.y0,
      y1: box.y1,
      lines: [
        { y: box.y0 + bh * 0.36, label: "brow line" },
        { y: box.y0 + bh * 0.5, label: "eye line (halfway down!)" },
        { y: box.y0 + bh * 0.72, label: "nose base" },
        { y: box.y0 + bh * 0.85, label: "mouth line" },
      ],
    };
  }

  // ============================================================
  //  LINE ART (XDoG) + BLOCK-IN + SHADING
  // ============================================================
  function makeLineCanvas(vals) {
    const w = state.w,
      h = state.h;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const out = ctx.createImageData(w, h);
    const d = out.data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      let v = clamp(Math.round(vals[i] * 255), 0, 255);
      if (v < 128) mask[i] = 1;
      // gently deepen the darker mid lines so they read as pencil, not gray
      if (v < 200) v = Math.round(v * 0.7);
      d[i * 4] = v;
      d[i * 4 + 1] = v;
      d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return { canvas, mask };
  }

  // Local contrast enhancement (unsharp / CLAHE-style). Faces are smoothly
  // lit, so eyes, nostrils and the lip line are low-contrast and a plain line
  // pass misses them. Boosting local contrast — strongest inside the face —
  // turns those subtle features into real lines without adding global noise.
  function enhanceForDetail() {
    const w = state.w,
      h = state.h,
      n = w * h;
    const big = gaussianBlur(state.gray, w, h, 6);
    const box = state.faceBox;
    const feather = Math.max(8, Math.round(Math.min(w, h) / 40));
    const base = 0.25; // mild global crispness
    const faceBoost = 1.05; // extra local contrast on the face
    const out = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let wgt = 0;
        if (box) {
          const d = Math.min(x - box.x0, box.x1 - x, y - box.y0, box.y1 - y);
          wgt = clamp(d / feather, 0, 1);
        }
        const amount = base + faceBoost * wgt;
        const v = state.gray[i] + amount * (state.gray[i] - big[i]);
        out[i] = clamp(v, 0, 255) / 255;
      }
    }
    return out;
  }

  function buildLines() {
    const w = state.w,
      h = state.h,
      n = w * h;
    const gray01 = new Float32Array(n);
    for (let i = 0; i < n; i++) gray01[i] = state.gray[i] / 255;

    // Detail pass uses a face-enhanced version so features come through.
    const grayDetail = enhanceForDetail();

    const detail = state.detail; // 0..1
    // higher detail -> smaller base blur -> finer lines (but never noisy)
    const detailSigma = 1.5 - detail * 0.75; // ~[1.5 .. 0.75]
    const detailVals = xdog(grayDetail, w, h, {
      sigma: detailSigma,
      k: 1.6,
      tau: 0.985,
      phi: 18,
      eps: 0.002,
    });
    const dline = makeLineCanvas(detailVals);
    state.edgeCanvas = dline.canvas;
    state.edgeMask = dline.mask;

    // Block-in: big shapes only (large blur, fewer lines)
    const blockVals = xdog(gray01, w, h, {
      sigma: 2.6,
      k: 1.6,
      tau: 0.965,
      phi: 14,
      eps: 0.008,
    });
    state.blockCanvas = makeLineCanvas(blockVals).canvas;
  }

  // Hatching over dark areas, for the shading phase.
  function buildShading() {
    const w = state.w,
      h = state.h;

    const maskFor = (thr) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const cx = c.getContext("2d");
      const id = cx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const on = state.gray[i] < thr;
        id.data[i * 4] = 40;
        id.data[i * 4 + 1] = 40;
        id.data[i * 4 + 2] = 40;
        id.data[i * 4 + 3] = on ? 255 : 0;
      }
      cx.putImageData(id, 0, 0);
      return c;
    };

    const hatch = (angleDeg, spacing, alpha) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const cx = c.getContext("2d");
      cx.save();
      cx.translate(w / 2, h / 2);
      cx.rotate((angleDeg * Math.PI) / 180);
      cx.strokeStyle = `rgba(35,35,35,${alpha})`;
      cx.lineWidth = 1.4;
      const len = Math.hypot(w, h);
      for (let x = -len; x < len; x += spacing) {
        cx.beginPath();
        cx.moveTo(x, -len);
        cx.lineTo(x, len);
        cx.stroke();
      }
      cx.restore();
      return c;
    };

    const shade = document.createElement("canvas");
    shade.width = w;
    shade.height = h;
    const sctx = shade.getContext("2d");

    // dark areas: single hatch
    let layer = hatch(45, 6, 0.5);
    let lctx = layer.getContext("2d");
    lctx.globalCompositeOperation = "destination-in";
    lctx.drawImage(maskFor(115), 0, 0);
    sctx.drawImage(layer, 0, 0);

    // very dark areas: add cross-hatch
    layer = hatch(-45, 6, 0.5);
    lctx = layer.getContext("2d");
    lctx.globalCompositeOperation = "destination-in";
    lctx.drawImage(maskFor(65), 0, 0);
    sctx.drawImage(layer, 0, 0);

    state.shadeCanvas = shade;
  }

  // The finished line drawing (white paper + detailed lines)
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

  // ============================================================
  //  GRID + CELLS
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

  const ORIENT_WORDS = [
    "mostly horizontal",
    "diagonal (bottom-left to top-right)",
    "mostly vertical",
    "diagonal (top-left to bottom-right)",
  ];
  function brightnessWord(b) {
    if (b > 205) return { tone: "very light", note: "faint, soft marks only" };
    if (b > 165) return { tone: "light", note: "light, soft pencil pressure" };
    if (b > 110) return { tone: "medium", note: "medium pressure" };
    if (b > 60) return { tone: "dark", note: "press firmer, this is a shadow" };
    return { tone: "very dark", note: "one of the darkest areas" };
  }
  function densityWord(d) {
    if (d < 0.006) return "empty";
    if (d < 0.03) return "a few";
    if (d < 0.09) return "several";
    return "many";
  }

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
              let a = state.ang[i] + Math.PI / 2;
              a = ((a % Math.PI) + Math.PI) % Math.PI;
              const deg = (a * 180) / Math.PI;
              let bin;
              if (deg < 22.5 || deg >= 157.5) bin = 0;
              else if (deg < 67.5) bin = 1;
              else if (deg < 112.5) bin = 2;
              else bin = 3;
              orient[bin] += state.mag[i];
            }
          }
        }
        const brightness = px ? brightSum / px : 255;
        const density = px ? edgePx / px : 0;
        let dom = 0;
        for (let kk = 1; kk < 4; kk++) if (orient[kk] > orient[dom]) dom = kk;
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
          hasContent: density > 0.006,
          inFace: px && faceHits / px > 0.35,
          feature: null,
        });
      }
    }
    // Assign each facial feature to the grid cell it overlaps most, so eyes,
    // nose, mouth, etc. each reliably get their own feature instruction even
    // on a coarse grid. Higher-priority features win a shared cell.
    const priority = { eye: 6, mouth: 5, nose: 4, brow: 3, ear: 2 };
    const overlap = (c, f) => {
      const ox = Math.max(0, Math.min(c.x1, f.x1) - Math.max(c.x0, f.x0));
      const oy = Math.max(0, Math.min(c.y1, f.y1) - Math.max(c.y0, f.y0));
      return ox * oy;
    };
    state.features.forEach((f) => {
      let best = null,
        bestOv = 0;
      for (const c of cells) {
        const ov = overlap(c, f);
        if (ov > bestOv) {
          bestOv = ov;
          best = c;
        }
      }
      if (best && bestOv > 0) {
        if (!best.feature || priority[f.type] > priority[best.feature.type])
          best.feature = f;
      }
    });

    state.cells = cells;
    // Face-first ordering for the tutorial (draw the subject before the background)
    state.orderedCells = cells
      .slice()
      .sort((a, b) => {
        if (a.inFace !== b.inFace) return a.inFace ? -1 : 1;
        if (a.row !== b.row) return a.row - b.row;
        return a.col - b.col;
      });
  }

  function cellInstruction(cell) {
    const b = brightnessWord(cell.brightness);
    // If this cell sits on a known feature, teach that feature directly.
    if (cell.feature && cell.hasContent) {
      return `Cell ${cell.label}: ${cell.feature.tip}`;
    }
    const facePrefix = cell.inFace ? "👤 Face — take your time. " : "";
    if (!cell.hasContent) {
      if (cell.brightness < 110)
        return `Cell ${cell.label}: ${facePrefix}no outlines, but it's a solid ${b.tone} area — leave the lines and shade it evenly later.`;
      return `Cell ${cell.label}: ${facePrefix}almost empty — leave it blank for now.`;
    }
    const many = densityWord(cell.density);
    const dir = ORIENT_WORDS[cell.orient];
    return `Cell ${cell.label}: ${facePrefix}draw ${many} ${dir} line(s). Match where each line enters and leaves the cell. (${b.tone})`;
  }

  // ============================================================
  //  STEPS (phased like a real lesson)
  // ============================================================
  const PHASES = {
    overview: { name: "Overview", cls: "ph-overview" },
    block: { name: "Block-in", cls: "ph-block" },
    guides: { name: "Proportions", cls: "ph-guides" },
    detail: { name: "Detail", cls: "ph-detail" },
    shade: { name: "Shading", cls: "ph-shade" },
    finish: { name: "Finish", cls: "ph-finish" },
  };

  function buildSteps() {
    const steps = [];
    steps.push({
      type: "grid",
      phase: "overview",
      title: "Set up your grid",
      text: `Lightly draw a grid on your paper: ${state.cols} columns (A–${colLabel(
        state.cols - 1
      )}) and ${state.rows} rows (1–${state.rows}). Keep it faint — you'll erase it. The full sketch is on the right; click any step to see how that part is drawn.`,
    });

    steps.push({
      type: "block",
      phase: "block",
      title: "Block in the big shapes",
      text: "Start loose. Lightly draw only the largest outlines — the overall silhouette and the main boundaries. Don't chase any detail yet; just get the big shapes in the right place.",
    });

    if (state.faceBox) {
      steps.push({
        type: "guides",
        phase: "guides",
        title: "Mark the face proportions",
        text: "Inside the face box, add light guide lines: a vertical center line, then the brow, eye, nose and mouth lines. Remember the #1 beginner fix — the eyes sit about halfway down the head, not near the top.",
      });
    }

    state.orderedCells.forEach((cell) => {
      steps.push({
        type: "cell",
        phase: "detail",
        cell,
        title: cell.feature
          ? `Cell ${cell.label} · ${cell.feature.label}`
          : cell.inFace
          ? `Cell ${cell.label} · face`
          : `Cell ${cell.label}`,
        text: cellInstruction(cell),
      });
    });

    steps.push({
      type: "shade",
      phase: "shade",
      title: "Add the shading",
      text: "Now the values. Squint at the photo so detail disappears and only light/dark shapes remain. Work light-to-dark, and build the shadows with hatching — extra, crossed lines for the very darkest spots.",
    });

    steps.push({
      type: "finish",
      phase: "finish",
      title: "Clean up",
      text: "Gently erase the grid and guide lines, firm up the strongest outlines, and deepen the darkest darks. Step back — you've drawn the photo. 🎉",
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
        li.innerHTML = `<span class="phase-pill ${PHASES[s.phase].cls}">${PHASES[s.phase].name}</span>${s.title}`;
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
    computeGradient();
    state.faceBox = detectFaceBox();
    state.guides = computeGuides(state.faceBox);
    state.features = computeFeatures(state.faceBox);
    buildLines();
    buildShading();
    buildGrid();
    analyzeCells();
    buildFull();
    buildSteps();
    buildStepsList();
    stepTotal.textContent = state.steps.length;
    showStep(0, false);
  }

  function rebuildDetail() {
    state.detail = detailRange.value / 100;
    buildLines();
    buildShading();
    analyzeCells();
    buildFull();
    buildSteps();
    buildStepsList();
    stepTotal.textContent = state.steps.length;
    showStep(0, false);
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
    for (let c = 0; c < state.cols; c++)
      ctx.fillText(colLabel(c), (c + 0.5) * state.cellW, 3);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let r = 0; r < state.rows; r++)
      ctx.fillText(String(r + 1), 3, (r + 0.5) * state.cellH);
    ctx.restore();
  }

  function cellHighlight(ctx, cell) {
    ctx.save();
    ctx.fillStyle = "rgba(255,179,71,0.16)";
    ctx.strokeStyle = "rgba(255,179,71,0.95)";
    ctx.lineWidth = 3;
    ctx.fillRect(cell.x0, cell.y0, cell.x1 - cell.x0, cell.y1 - cell.y0);
    ctx.strokeRect(cell.x0 + 1.5, cell.y0 + 1.5, cell.x1 - cell.x0 - 3, cell.y1 - cell.y0 - 3);
    ctx.restore();
  }

  function drawGuides(ctx, progress, withLabels) {
    const g = state.guides;
    if (!g) return;
    ctx.save();
    ctx.strokeStyle = "rgba(110,168,254,0.95)";
    ctx.fillStyle = "rgba(110,168,254,1)";
    ctx.lineWidth = 1.5;
    ctx.font = `${Math.max(10, Math.round((g.x1 - g.x0) * 0.09))}px Inter, sans-serif`;
    ctx.textBaseline = "bottom";
    // sequence: center line, then each horizontal line
    const items = 1 + g.lines.length;
    const shown = progress * items;
    if (shown > 0) {
      ctx.beginPath();
      ctx.moveTo(g.cx, g.y0);
      ctx.lineTo(g.cx, g.y1);
      ctx.stroke();
    }
    g.lines.forEach((ln, idx) => {
      if (shown > idx + 1) {
        ctx.beginPath();
        ctx.moveTo(g.x0, ln.y);
        ctx.lineTo(g.x1, ln.y);
        ctx.stroke();
        if (withLabels) ctx.fillText(ln.label, g.x0 + 4, ln.y - 2);
      }
    });
    ctx.restore();
  }

  // Reference photo + grid + labels + face box + (optional) guides + active cell
  function renderReference(activeCell, showGuides) {
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
    if (showGuides) {
      drawGuides(refCtx, 1, true);
      drawFeatureMarks(refCtx);
    }
    if (activeCell) cellHighlight(refCtx, activeCell);
  }

  function drawFeatureMarks(ctx) {
    ctx.save();
    ctx.strokeStyle = "rgba(181,139,255,0.95)";
    ctx.fillStyle = "rgba(181,139,255,1)";
    ctx.lineWidth = 1.5;
    ctx.font = `${Math.max(9, Math.round(state.w * 0.02))}px Inter, sans-serif`;
    ctx.textBaseline = "bottom";
    const seen = {};
    state.features.forEach((f) => {
      ctx.strokeRect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
      // label each feature type once to avoid clutter
      if (!seen[f.type]) {
        ctx.fillText(f.label, f.x0, f.y0 - 1);
        seen[f.type] = 1;
      }
    });
    ctx.restore();
  }

  function renderComplete(gridProgress = 1, faded = false) {
    drawCtx.clearRect(0, 0, state.w, state.h);
    drawCtx.drawImage(state.full, 0, 0);
    drawGrid(drawCtx, gridProgress, faded);
  }

  function pencilAt(ctx, x, y, size) {
    ctx.save();
    ctx.font = `${size}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✏️", x, y);
    ctx.restore();
  }

  // ============================================================
  //  STEP DISPLAY
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
    const ph = PHASES[step.phase];
    phaseTag.textContent = ph.name;
    phaseTag.className = "phase-tag " + ph.cls;
    [...stepsOl.children].forEach((li, i) =>
      li.classList.toggle("active", i === index)
    );
    const activeLi = stepsOl.children[index];
    if (activeLi) activeLi.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function showStep(index, animate = true, onDone) {
    cancelAnim();
    index = clamp(index, 0, state.steps.length - 1);
    state.current = index;
    const step = state.steps[index];
    updateInstructionUI(step, index);
    renderReference(step.type === "cell" ? step.cell : null, step.type === "guides");

    switch (step.type) {
      case "grid":
        if (animate) animateGrid(onDone);
        else {
          renderComplete(1, false);
          onDone && onDone();
        }
        break;
      case "block":
        animate ? animateWipe(state.blockCanvas, 1500, onDone) : (drawStaticLayer(state.blockCanvas), onDone && onDone());
        break;
      case "guides":
        if (animate) animateGuidesStep(onDone);
        else {
          renderComplete(1, true);
          drawGuides(drawCtx, 1, true);
          onDone && onDone();
        }
        break;
      case "cell":
        if (animate) animateCell(step.cell, onDone);
        else {
          renderComplete(1, false);
          cellHighlight(drawCtx, step.cell);
          onDone && onDone();
        }
        break;
      case "shade":
        if (animate) animateShade(onDone);
        else {
          renderComplete(1, false);
          drawCtx.drawImage(state.shadeCanvas, 0, 0);
          onDone && onDone();
        }
        break;
      case "finish":
        renderComplete(1, true);
        drawCtx.drawImage(state.shadeCanvas, 0, 0);
        onDone && onDone();
        break;
    }
  }

  function drawStaticLayer(layer) {
    drawCtx.clearRect(0, 0, state.w, state.h);
    drawCtx.fillStyle = "#fff";
    drawCtx.fillRect(0, 0, state.w, state.h);
    drawCtx.drawImage(layer, 0, 0);
    drawGrid(drawCtx, 1, false);
  }

  function animate(duration, draw, onDone) {
    const token = state.animToken;
    const start = performance.now();
    const tick = (now) => {
      if (token !== state.animToken) return;
      const p = Math.min(1, (now - start) / (duration / state.speed));
      draw(p);
      if (p < 1) state.raf = requestAnimationFrame(tick);
      else {
        state.raf = null;
        onDone && onDone();
      }
    };
    state.raf = requestAnimationFrame(tick);
  }

  function animateGrid(onDone) {
    animate(1400, (p) => renderComplete(p, false), onDone);
  }

  // Reveal a full-canvas line layer left-to-right on blank paper (block-in)
  function animateWipe(layer, dur, onDone) {
    animate(
      dur,
      (p) => {
        drawCtx.clearRect(0, 0, state.w, state.h);
        drawCtx.fillStyle = "#fff";
        drawCtx.fillRect(0, 0, state.w, state.h);
        const rw = Math.round(state.w * p);
        if (rw > 0) drawCtx.drawImage(layer, 0, 0, rw, state.h, 0, 0, rw, state.h);
        drawGrid(drawCtx, 1, false);
        if (p < 1) pencilAt(drawCtx, rw, state.h * 0.5, Math.round(state.cellH * 0.5));
      },
      onDone
    );
  }

  function animateGuidesStep(onDone) {
    animate(
      1600,
      (p) => {
        renderComplete(1, true);
        drawGuides(drawCtx, p, true);
      },
      onDone
    );
  }

  // Re-draw ONE cell on top of the finished sketch, with a pencil trace
  function animateCell(cell, onDone) {
    const cw = cell.x1 - cell.x0,
      ch = cell.y1 - cell.y0;
    animate(
      950,
      (p) => {
        renderComplete(1, false);
        const rw = Math.round(cw * p);
        drawCtx.save();
        drawCtx.fillStyle = "#fff";
        drawCtx.fillRect(cell.x0, cell.y0, cw, ch);
        if (rw > 0)
          drawCtx.drawImage(state.edgeCanvas, cell.x0, cell.y0, rw, ch, cell.x0, cell.y0, rw, ch);
        drawCtx.restore();
        drawGrid(drawCtx, 1, false);
        cellHighlight(drawCtx, cell);
        if (p < 1) pencilAt(drawCtx, cell.x0 + rw, cell.y0 + ch * 0.5, Math.round(ch * 0.5));
      },
      onDone
    );
  }

  function animateShade(onDone) {
    animate(
      1500,
      (p) => {
        renderComplete(1, false);
        const rh = Math.round(state.h * p);
        if (rh > 0)
          drawCtx.drawImage(state.shadeCanvas, 0, 0, state.w, rh, 0, 0, state.w, rh);
        if (p < 1) pencilAt(drawCtx, state.w * 0.5, rh, Math.round(state.cellH * 0.5));
      },
      onDone
    );
  }

  // ============================================================
  //  WATCH IT DRAWN  (progressive build through all phases)
  // ============================================================
  function watchFullBuild() {
    cancelAnim();
    state.playing = false;
    setPlayIcon();
    const token = state.animToken;
    let idx = 0;
    const run = () => {
      if (token !== state.animToken) return;
      if (idx >= state.steps.length) return;
      state.current = idx;
      showStep(idx, true, () => {
        if (token !== state.animToken) return;
        idx++;
        setTimeout(run, 180 / state.speed);
      });
    };
    run();
  }
  buildBtn.addEventListener("click", watchFullBuild);

  // ============================================================
  //  GUIDED TOUR (play)
  // ============================================================
  function setPlayIcon() {
    playBtn.textContent = state.playing ? "⏸" : "▶";
  }
  function playTour() {
    const token = state.animToken;
    const step = () => {
      if (token !== state.animToken || !state.playing) return;
      if (state.current >= state.steps.length - 1) {
        showStep(state.current, false);
        state.playing = false;
        setPlayIcon();
        return;
      }
      state.current++;
      showStep(state.current, true, () => {
        if (token !== state.animToken || !state.playing) return;
        setTimeout(step, 220 / state.speed);
      });
    };
    // animate current, then continue
    showStep(state.current, true, () => {
      if (token !== state.animToken || !state.playing) return;
      setTimeout(step, 220 / state.speed);
    });
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

  helpBtn.addEventListener("click", () => (helpModal.hidden = false));
  helpClose.addEventListener("click", () => (helpModal.hidden = true));
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) helpModal.hidden = true;
  });

  // ============================================================
  //  EXPORT / DOWNLOAD / PRINT
  // ============================================================
  const exportBtn = $("exportBtn");
  const exportModal = $("exportModal");
  const exportClose = $("exportClose");

  function newCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  function invertCanvas(ctx, w, h) {
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 255 - d[i];
      d[i + 1] = 255 - d[i + 1];
      d[i + 2] = 255 - d[i + 2];
    }
    ctx.putImageData(id, 0, 0);
  }

  function composeSketch(opts) {
    const w = state.w,
      h = state.h;
    const c = newCanvas(w, h);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(state.full, 0, 0);
    if (opts.shading) ctx.drawImage(state.shadeCanvas, 0, 0);
    if (opts.grid) drawGrid(ctx, 1, false);
    if (opts.invert) invertCanvas(ctx, w, h);
    return c;
  }

  // Crisp, printable grid sheet (drawn fresh so it scales cleanly).
  function composeGridSheet(labels, scale = 2) {
    const w = state.w,
      h = state.h;
    const c = newCanvas(w * scale, h * scale);
    const ctx = c.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#c8c8c8";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    for (let col = 1; col < state.cols; col++) {
      const x = Math.round(col * state.cellW) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let row = 1; row < state.rows; row++) {
      const y = Math.round(row * state.cellH) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    if (labels) {
      ctx.fillStyle = "#888";
      ctx.font = `${Math.max(9, Math.round(state.cellW * 0.2))}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let col = 0; col < state.cols; col++)
        ctx.fillText(colLabel(col), (col + 0.5) * state.cellW, 3);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (let row = 0; row < state.rows; row++)
        ctx.fillText(String(row + 1), 3, (row + 0.5) * state.cellH);
    }
    return c;
  }

  function composeReference() {
    const w = state.w,
      h = state.h;
    const c = newCanvas(w, h);
    const ctx = c.getContext("2d");
    ctx.drawImage(state.srcCanvas, 0, 0);
    drawGrid(ctx, 1, false);
    drawGridLabels(ctx);
    return c;
  }

  function downloadCanvas(canvas, name) {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function printCanvas(canvas, title) {
    const url = canvas.toDataURL("image/png");
    const wnd = window.open("", "_blank");
    if (!wnd) {
      alert("Please allow pop-ups to print, or use Download PNG instead.");
      return;
    }
    wnd.document.write(
      `<!DOCTYPE html><html><head><title>${title}</title>` +
        `<style>@page{margin:10mm}html,body{margin:0}` +
        `body{display:flex;align-items:center;justify-content:center;min-height:100vh}` +
        `img{max-width:100%;max-height:100vh;height:auto}</style></head>` +
        `<body><img src="${url}" onload="setTimeout(function(){window.focus();window.print();},100)"></body></html>`
    );
    wnd.document.close();
  }

  const opt = (id) => document.getElementById(id).checked;

  function runExport(action) {
    switch (action) {
      case "sketch-png":
        downloadCanvas(
          composeSketch({ grid: opt("optGrid"), shading: opt("optShading"), invert: opt("optInvert") }),
          "my-sketch.png"
        );
        break;
      case "sketch-print":
        printCanvas(
          composeSketch({ grid: opt("optGrid"), shading: opt("optShading"), invert: opt("optInvert") }),
          "My Sketch"
        );
        break;
      case "sheet-png":
        downloadCanvas(composeGridSheet(opt("optSheetLabels")), "grid-sheet.png");
        break;
      case "sheet-print":
        printCanvas(composeGridSheet(opt("optSheetLabels")), "Grid Sheet");
        break;
      case "ref-png":
        downloadCanvas(composeReference(), "reference-grid.png");
        break;
      case "ref-print":
        printCanvas(composeReference(), "Reference with Grid");
        break;
    }
  }

  exportBtn.addEventListener("click", () => (exportModal.hidden = false));
  exportClose.addEventListener("click", () => (exportModal.hidden = true));
  exportModal.addEventListener("click", (e) => {
    if (e.target === exportModal) exportModal.hidden = true;
    const btn = e.target.closest("[data-do]");
    if (btn) runExport(btn.getAttribute("data-do"));
  });

  // ============================================================
  //  SAMPLE IMAGES
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
      ctx.arc(w * 0.4, h * 0.48, 4.5, 0, 7);
      ctx.arc(w * 0.6, h * 0.48, 4.5, 0, 7);
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
      ctx.arc(w * 0.78, h * 0.22, w * 0.1, 0, 7);
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
      ctx.arc(w * 0.45, h * 0.56, w * 0.22, 0, 7);
      ctx.arc(w * 0.58, h * 0.56, w * 0.2, 0, 7);
      ctx.fill();
      ctx.fillStyle = "#5a3b1a";
      ctx.fillRect(w * 0.5, h * 0.3, 5, h * 0.14);
      ctx.fillStyle = "#4e9d3a";
      ctx.beginPath();
      ctx.ellipse(w * 0.57, h * 0.34, 16, 8, -0.6, 0, 7);
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

  window.__sketch = { state };
})();
