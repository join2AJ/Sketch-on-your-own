/* ============================================================
   Sketch on Your Own
   Upload a photo -> grid-method, step-by-step drawing tutorial.
   100% client-side. No dependencies. No uploads.
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
    edgeCanvas: null, // offscreen: white bg + black edge lines
    committed: null, // offscreen: accumulated drawing (white + completed cells)
    cells: [], // per-cell analysis
    steps: [], // ordered tutorial steps
    current: 0,
    playing: false,
    anim: null, // {p, duration, start}
    speed: 1,
    detail: 0.45,
    raf: null,
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
  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    handleFile(file);
  });

  newImageBtn.addEventListener("click", () => {
    stopLoop();
    state.playing = false;
    studioView.hidden = true;
    uploadView.hidden = false;
  });

  // ============================================================
  //  STUDIO SETUP
  // ============================================================
  function startStudio(img) {
    state.img = img;

    // Compute working resolution (fit within MAX_DIM, keep aspect ratio)
    let { width, height } = img;
    const scale = Math.min(1, MAX_DIM / Math.max(width, height));
    state.w = Math.max(1, Math.round(width * scale));
    state.h = Math.max(1, Math.round(height * scale));

    // Size the visible canvases
    [refCanvas, drawCanvas].forEach((c) => {
      c.width = state.w;
      c.height = state.h;
    });

    uploadView.hidden = true;
    studioView.hidden = false;

    processImage();
    buildEverything();
  }

  // Draw source image into an offscreen canvas and read pixels
  function processImage() {
    const off = document.createElement("canvas");
    off.width = state.w;
    off.height = state.h;
    const octx = off.getContext("2d", { willReadFrequently: true });
    octx.drawImage(state.img, 0, 0, state.w, state.h);
    const { data } = octx.getImageData(0, 0, state.w, state.h);

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
  }

  // A light box blur to reduce noise before edge detection
  function blur(src, w, h) {
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

  // Sobel edge detection -> magnitude + gradient angle
  function computeEdges() {
    const w = state.w,
      h = state.h;
    const g = blur(state.gray, w, h);
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
        ang[i] = Math.atan2(gy, gx); // gradient direction
        if (m > maxMag) maxMag = m;
      }
    }
    return { mag, ang, maxMag };
  }

  // Render the edges as clean black lines on white -> edgeCanvas
  function renderEdgeCanvas(edges) {
    const w = state.w,
      h = state.h;
    const { mag, maxMag } = edges;
    // detail slider: higher sensitivity -> lower threshold -> more lines
    const thr = 0.30 - state.detail * 0.24; // range ~[0.06 .. 0.30]

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(w, h);
    const d = imgData.data;

    for (let i = 0; i < w * h; i++) {
      const nm = mag[i] / maxMag;
      let v = 255; // white
      if (nm > thr) {
        // stronger edge -> darker line, with a little gamma for contrast
        const t = Math.min(1, (nm - thr) / (1 - thr));
        v = Math.round(255 * (1 - Math.pow(t, 0.7)));
      }
      d[i * 4] = v;
      d[i * 4 + 1] = v;
      d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    state.edgeCanvas = canvas;
    state.edges = edges;
    state.edgeThr = thr;
  }

  // ============================================================
  //  GRID + CELL ANALYSIS
  // ============================================================
  function buildGrid() {
    state.cols = parseInt(gridSelect.value, 10);
    // choose row count so cells stay roughly square
    const targetCell = state.w / state.cols;
    state.rows = Math.max(1, Math.round(state.h / targetCell));
    state.cellW = state.w / state.cols;
    state.cellH = state.h / state.rows;
  }

  const colLabel = (c) => {
    // A, B, ... Z, AA, AB ...
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
    const { mag, ang, maxMag } = state.edges;
    const w = state.w;
    const cells = [];
    const thr = state.edgeThr;

    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        const x0 = Math.round(c * state.cellW);
        const y0 = Math.round(r * state.cellH);
        const x1 = Math.round((c + 1) * state.cellW);
        const y1 = Math.round((r + 1) * state.cellH);

        let brightSum = 0,
          px = 0,
          edgePx = 0;
        // orientation histogram: 0=horizontal,1=diag/,2=vertical,3=diag\
        const orient = [0, 0, 0, 0];

        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = y * w + x;
            brightSum += state.gray[i];
            px++;
            const nm = mag[i] / maxMag;
            if (nm > thr) {
              edgePx++;
              // edge direction is perpendicular to gradient
              let a = ang[i] + Math.PI / 2;
              // fold into [0, PI)
              a = ((a % Math.PI) + Math.PI) % Math.PI;
              const deg = (a * 180) / Math.PI;
              let bin;
              if (deg < 22.5 || deg >= 157.5) bin = 0; // horizontal
              else if (deg < 67.5) bin = 1; // diagonal /
              else if (deg < 112.5) bin = 2; // vertical
              else bin = 3; // diagonal \
              orient[bin] += nm;
            }
          }
        }

        const brightness = px ? brightSum / px : 255;
        const density = px ? edgePx / px : 0;
        let dom = 0;
        for (let k = 1; k < 4; k++) if (orient[k] > orient[dom]) dom = k;

        cells.push({
          r,
          c,
          label: colLabel(c) + (r + 1),
          x0,
          y0,
          x1,
          y1,
          brightness,
          density,
          orient: dom,
          hasContent: density > 0.012,
        });
      }
    }
    state.cells = cells;
  }

  // ---- Instruction text generation ----
  const ORIENT_WORDS = [
    "mostly horizontal",
    "diagonal (bottom-left to top-right)",
    "mostly vertical",
    "diagonal (top-left to bottom-right)",
  ];

  function brightnessWord(b) {
    if (b > 205) return { tone: "very light", note: "keep it almost blank — just faint marks" };
    if (b > 165) return { tone: "light", note: "use light, soft pencil pressure" };
    if (b > 110) return { tone: "medium", note: "use medium pressure and gentle shading" };
    if (b > 60) return { tone: "dark", note: "press firmer and shade this area in" };
    return { tone: "very dark", note: "shade this heavily — it's one of the darkest areas" };
  }

  function densityWord(d) {
    if (d < 0.012) return "empty";
    if (d < 0.05) return "a few";
    if (d < 0.14) return "several";
    return "many";
  }

  function cellInstruction(cell) {
    const b = brightnessWord(cell.brightness);
    if (!cell.hasContent) {
      // No edges here = a flat region. What matters is how dark it is.
      if (cell.brightness < 110) {
        return `Cell ${cell.label}: no outlines here, but it's a solid ${b.tone} area — shade it evenly and fairly dark, edge to edge.`;
      }
      if (cell.brightness < 165) {
        return `Cell ${cell.label}: no real lines — just lay down smooth, even ${b.tone} shading across the whole cell.`;
      }
      return `Cell ${cell.label}: almost nothing here — leave it blank, or add only a whisper of light shading.`;
    }
    const many = densityWord(cell.density);
    const dir = ORIENT_WORDS[cell.orient];
    return `Cell ${cell.label}: draw ${many} ${dir} lines. This area is ${b.tone} — ${b.note}.`;
  }

  // ============================================================
  //  BUILD STEP SEQUENCE
  // ============================================================
  function buildSteps() {
    const steps = [];

    steps.push({
      type: "grid",
      title: "Step 1 · Set up your grid",
      text: `Lightly draw a grid on your paper: ${state.cols} columns (A–${colLabel(
        state.cols - 1
      )}) across and ${state.rows} rows (1–${state.rows}) down. Keep the lines faint so you can erase them later. We'll fill it one cell at a time.`,
    });

    // Cells in reading order, but skip visually-empty ones from the *spoken*
    // flow only if truly blank — still keep them so numbering is complete.
    state.cells.forEach((cell) => {
      steps.push({
        type: "cell",
        cell,
        title: `Cell ${cell.label}`,
        text: cellInstruction(cell),
      });
    });

    steps.push({
      type: "finish",
      title: "Final step · Clean up",
      text: "Gently erase your grid lines, darken the strongest outlines, and deepen the shadows where the photo is darkest. Step back — you've drawn the photo. 🎉",
    });

    state.steps = steps;
    state.current = 0;
  }

  function buildStepsList() {
    stepsOl.innerHTML = "";
    state.steps.forEach((s, idx) => {
      const li = document.createElement("li");
      if (s.type === "cell") {
        li.innerHTML = `<span class="cell-tag">${s.cell.label}</span>${stripLabel(
          s.text
        )}`;
      } else {
        li.textContent = s.text;
      }
      li.addEventListener("click", () => gotoStep(idx));
      stepsOl.appendChild(li);
    });
  }

  const stripLabel = (t) => t.replace(/^Cell\s+\S+:\s*/, "");

  // ============================================================
  //  MASTER BUILD (called on load + when controls change)
  // ============================================================
  function buildEverything() {
    state.detail = detailRange.value / 100;
    state.speed = parseFloat(speedSelect.value);

    const edges = computeEdges();
    renderEdgeCanvas(edges);
    buildGrid();
    analyzeCells();
    buildSteps();
    buildStepsList();

    // committed canvas (accumulated drawing surface)
    const cc = document.createElement("canvas");
    cc.width = state.w;
    cc.height = state.h;
    state.committed = cc;

    stepTotal.textContent = state.steps.length;
    gotoStep(0, false);
  }

  // Rebuild only line-detail dependent parts (keeps grid selection)
  function rebuildDetail() {
    state.detail = detailRange.value / 100;
    renderEdgeCanvas(state.edges); // re-threshold with new detail
    analyzeCells();
    buildSteps();
    buildStepsList();
    gotoStep(0, false);
  }

  gridSelect.addEventListener("change", buildEverything);
  detailRange.addEventListener("change", rebuildDetail);
  speedSelect.addEventListener("change", () => {
    state.speed = parseFloat(speedSelect.value);
  });

  // ============================================================
  //  RENDERING
  // ============================================================
  function fillWhite(ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, state.w, state.h);
  }

  // Rebuild the committed surface to include all cells strictly before index k
  function rebuildCommitted(cellCountDone) {
    const ctx = state.committed.getContext("2d");
    fillWhite(ctx);
    for (let i = 0; i < cellCountDone; i++) {
      const cell = state.cells[i];
      copyCell(ctx, cell);
    }
  }

  function copyCell(ctx, cell) {
    const { x0, y0, x1, y1 } = cell;
    ctx.drawImage(
      state.edgeCanvas,
      x0,
      y0,
      x1 - x0,
      y1 - y0,
      x0,
      y0,
      x1 - x0,
      y1 - y0
    );
  }

  // Draw grid lines onto a context (light, artist-grid style)
  function drawGrid(ctx, progress = 1, faded = false) {
    ctx.save();
    ctx.strokeStyle = faded ? "rgba(120,140,200,0.18)" : "rgba(90,110,170,0.42)";
    ctx.lineWidth = 1;

    const totalLines = state.cols - 1 + (state.rows - 1) + 2; // inner + border
    const linesToDraw = Math.ceil(totalLines * progress);
    let drawn = 0;

    // border
    ctx.strokeRect(0.5, 0.5, state.w - 1, state.h - 1);
    drawn += 2;

    // vertical inner lines
    for (let c = 1; c < state.cols && drawn < linesToDraw; c++) {
      const x = Math.round(c * state.cellW) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, state.h);
      ctx.stroke();
      drawn++;
    }
    // horizontal inner lines
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

  // Draw column letters / row numbers around the reference image
  function drawGridLabels(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `${Math.max(10, Math.round(state.cellW * 0.22))}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let c = 0; c < state.cols; c++) {
      const x = (c + 0.5) * state.cellW;
      ctx.fillText(colLabel(c), x, 3);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let r = 0; r < state.rows; r++) {
      const y = (r + 0.5) * state.cellH;
      ctx.fillText(String(r + 1), 3, y);
    }
    ctx.restore();
  }

  // Reference panel: photo + grid overlay + highlight current cell
  function renderReference(activeCell) {
    refCtx.clearRect(0, 0, state.w, state.h);
    refCtx.drawImage(state.srcCanvas, 0, 0);
    // dim overlay for contrast of grid
    drawGrid(refCtx, 1, false);
    drawGridLabels(refCtx);

    if (activeCell) {
      refCtx.save();
      refCtx.fillStyle = "rgba(255,179,71,0.22)";
      refCtx.strokeStyle = "rgba(255,179,71,0.95)";
      refCtx.lineWidth = 3;
      const { x0, y0, x1, y1 } = activeCell;
      refCtx.fillRect(x0, y0, x1 - x0, y1 - y0);
      refCtx.strokeRect(x0 + 1.5, y0 + 1.5, x1 - x0 - 3, y1 - y0 - 3);
      refCtx.restore();
    }
  }

  // Compose the drawing canvas for the current frame
  function renderDrawing(step, p) {
    drawCtx.clearRect(0, 0, state.w, state.h);
    drawCtx.drawImage(state.committed, 0, 0);

    if (step.type === "grid") {
      drawGrid(drawCtx, p, false);
      return;
    }

    if (step.type === "cell") {
      drawGrid(drawCtx, 1, false);
      const cell = step.cell;
      // reveal edges of this cell left-to-right (like a pencil scanning across)
      const cw = cell.x1 - cell.x0;
      const rw = Math.max(0, Math.round(cw * p));
      if (rw > 0) {
        drawCtx.drawImage(
          state.edgeCanvas,
          cell.x0,
          cell.y0,
          rw,
          cell.y1 - cell.y0,
          cell.x0,
          cell.y0,
          rw,
          cell.y1 - cell.y0
        );
      }
      // pencil at the reveal frontier
      if (p < 1) {
        const fx = cell.x0 + rw;
        const fy = cell.y0 + (cell.y1 - cell.y0) * 0.5;
        drawCtx.save();
        drawCtx.font = `${Math.round(state.cellH * 0.5)}px serif`;
        drawCtx.textAlign = "center";
        drawCtx.textBaseline = "middle";
        drawCtx.fillText("✏️", fx, fy);
        drawCtx.restore();
      }
      return;
    }

    if (step.type === "finish") {
      // show everything, grid faded to suggest erasing
      drawGrid(drawCtx, 1, true);
    }
  }

  // ============================================================
  //  STEP NAVIGATION + ANIMATION
  // ============================================================
  function gotoStep(index, animate = true) {
    stopLoop();
    index = Math.max(0, Math.min(state.steps.length - 1, index));
    state.current = index;
    const step = state.steps[index];

    // Prepare committed surface for this step
    if (step.type === "grid") {
      rebuildCommitted(0);
    } else if (step.type === "cell") {
      const cellIdx = state.cells.indexOf(step.cell);
      rebuildCommitted(cellIdx); // all previous cells drawn
    } else {
      rebuildCommitted(state.cells.length); // all cells drawn
    }

    updateInstructionUI(step, index);
    renderReference(step.type === "cell" ? step.cell : null);

    if (animate && step.type !== "finish") {
      startAnim(step);
    } else {
      // static full render
      renderDrawing(step, 1);
      if (step.type === "cell") commitCurrentCell(step);
    }
  }

  function commitCurrentCell(step) {
    // bake this cell into committed so navigation stays consistent
    const ctx = state.committed.getContext("2d");
    copyCell(ctx, step.cell);
  }

  function startAnim(step) {
    const base = step.type === "grid" ? 1600 : 1100;
    state.anim = {
      duration: base / state.speed,
      start: performance.now(),
      step,
    };
    if (state.playing) runLoop();
    else {
      // if not playing, still play THIS step's animation once
      state.playing = true;
      setPlayIcon();
      runLoop();
    }
  }

  function runLoop() {
    stopLoop();
    const tick = (now) => {
      const a = state.anim;
      if (!a) return;
      const p = Math.min(1, (now - a.start) / a.duration);
      renderDrawing(a.step, p);

      if (p >= 1) {
        // finalize step
        if (a.step.type === "cell") commitCurrentCell(a.step);
        state.raf = null;
        if (state.playing && state.current < state.steps.length - 1) {
          // brief pause, then advance
          state.raf = requestAnimationFrame(() =>
            setTimeout(() => advance(), 260 / state.speed)
          );
        } else {
          state.playing = false;
          setPlayIcon();
        }
        return;
      }
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  }

  function advance() {
    if (state.current < state.steps.length - 1) {
      state.current++;
      const step = state.steps[state.current];
      if (step.type === "cell") {
        rebuildCommitted(state.cells.indexOf(step.cell));
      } else if (step.type === "grid") {
        rebuildCommitted(0);
      } else {
        rebuildCommitted(state.cells.length);
      }
      updateInstructionUI(step, state.current);
      renderReference(step.type === "cell" ? step.cell : null);
      if (step.type === "finish") {
        renderDrawing(step, 1);
        state.playing = false;
        setPlayIcon();
      } else {
        state.anim = {
          duration: (step.type === "grid" ? 1600 : 1100) / state.speed,
          start: performance.now(),
          step,
        };
        runLoop();
      }
    }
  }

  function stopLoop() {
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
      li.classList.toggle("done", i < index);
    });
    const activeLi = stepsOl.children[index];
    if (activeLi) activeLi.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ---------- Transport controls ----------
  function setPlayIcon() {
    playBtn.textContent = state.playing ? "⏸" : "▶";
  }

  playBtn.addEventListener("click", () => {
    const step = state.steps[state.current];
    if (state.playing) {
      state.playing = false;
      stopLoop();
      setPlayIcon();
    } else {
      state.playing = true;
      setPlayIcon();
      if (step.type === "finish") {
        // restart from beginning if at the end
        gotoStep(0, true);
      } else {
        state.anim = {
          duration: (step.type === "grid" ? 1600 : 1100) / state.speed,
          start: performance.now(),
          step,
        };
        runLoop();
      }
    }
  });

  nextBtn.addEventListener("click", () => {
    state.playing = false;
    setPlayIcon();
    gotoStep(state.current + 1, true);
  });
  prevBtn.addEventListener("click", () => {
    state.playing = false;
    setPlayIcon();
    gotoStep(state.current - 1, true);
  });
  restartBtn.addEventListener("click", () => {
    state.playing = true;
    setPlayIcon();
    gotoStep(0, true);
  });

  // keyboard
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
  //  SAMPLE IMAGES (generated on a canvas, so no network needed)
  // ============================================================
  function makeSample(drawFn, w = 240, h = 240) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    drawFn(ctx, w, h);
    return c;
  }

  const samples = [
    // Simple face
    (ctx, w, h) => {
      ctx.fillStyle = "#e9e2d0";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#f0c9a0";
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w * 0.28, h * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#5a3b25";
      ctx.lineWidth = 4;
      // eyes
      ctx.beginPath();
      ctx.ellipse(w * 0.4, h * 0.45, 12, 7, 0, 0, Math.PI * 2);
      ctx.ellipse(w * 0.6, h * 0.45, 12, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#3a2a1a";
      ctx.beginPath();
      ctx.arc(w * 0.4, h * 0.45, 4, 0, Math.PI * 2);
      ctx.arc(w * 0.6, h * 0.45, 4, 0, Math.PI * 2);
      ctx.fill();
      // nose + mouth
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.48);
      ctx.lineTo(w * 0.47, h * 0.58);
      ctx.lineTo(w * 0.53, h * 0.58);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.62, w * 0.09, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      // hair
      ctx.fillStyle = "#3a2a1a";
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.34, w * 0.29, Math.PI, 0);
      ctx.fill();
    },
    // House / landscape
    (ctx, w, h) => {
      ctx.fillStyle = "#cfe6f5";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#8fca6b";
      ctx.fillRect(0, h * 0.66, w, h * 0.34);
      ctx.fillStyle = "#f7d774";
      ctx.beginPath();
      ctx.arc(w * 0.78, h * 0.22, w * 0.1, 0, Math.PI * 2);
      ctx.fill();
      // house
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
    // Apple still life
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
      const c = makeSample(fn);
      const btn = document.createElement("button");
      btn.className = "sample-thumb";
      const thumb = makeSample(fn, 92, 92);
      btn.appendChild(thumb);
      btn.addEventListener("click", () => loadImageFromSrc(c.toDataURL()));
      sampleRow.appendChild(btn);
    });
  }

  buildSamples();
})();
