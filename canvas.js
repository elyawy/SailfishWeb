import { state, NODE_R, HIT_R, PAD_LEFT, PAD_RIGHT, PAD_TOP, LEAF_GAP } from './state.js';
import { resolveModel, resolveIndel } from './tree.js';

const canvas = document.getElementById('tree-canvas');
const ctx    = canvas.getContext('2d');

// Callback set by main.js to avoid circular dependency with panel.js
let _onSelect = null;
export function setOnSelect(fn) { _onSelect = fn; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const dpr = () => window.devicePixelRatio || 1;
const lw  = () => canvas.width  / dpr();
const lh  = () => canvas.height / dpr();

// ── Canvas resize ─────────────────────────────────────────────────────────────
export function resizeCanvas() {
  const wrap = canvas.parentElement;
  const d    = dpr();
  canvas.width  = wrap.clientWidth  * d;
  canvas.height = wrap.clientHeight * d;
  canvas.style.width  = wrap.clientWidth  + 'px';
  canvas.style.height = wrap.clientHeight + 'px';
}

// ── World coords ──────────────────────────────────────────────────────────────
export function computeWXY() {
  if (!state.nodes.length) return;
  const maxX  = Math.max(...state.nodes.map(n => n.x)) || 1;
  const drawW = lw() - PAD_LEFT - PAD_RIGHT;
  for (const n of state.nodes) {
    n.wx = PAD_LEFT + (n.x / maxX) * drawW;
    n.wy = PAD_TOP  + n.y * LEAF_GAP;
  }
}

export function fitToView() {
  resizeCanvas();
  computeWXY();
  const leaves = state.nodes.filter(n => n.isLeaf).length;
  const totalH = PAD_TOP + leaves * LEAF_GAP + 20;
  state.zoom  = Math.min(1, (lh() - 40) / (totalH || 1));
  state.pan.x = 0;
  state.pan.y = Math.max(0, (lh() - totalH * state.zoom) / 2);
}

// ── Render ────────────────────────────────────────────────────────────────────
export function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.nodes.length) return;

  const d = dpr();

  ctx.save();
  ctx.scale(d, d);
  ctx.translate(state.pan.x, state.pan.y);
  ctx.scale(state.zoom, state.zoom);

  // Branches
  ctx.lineWidth   = 1 / state.zoom;
  ctx.strokeStyle = '#d0d0d0';
  for (const n of state.nodes) {
    if (n.parentId === null) continue;
    const p = state.nodes[n.parentId];
    ctx.beginPath();
    ctx.moveTo(p.wx, p.wy);
    ctx.lineTo(p.wx, n.wy);
    ctx.lineTo(n.wx, n.wy);
    ctx.stroke();
  }

  // Nodes
  for (const n of state.nodes) {
    const sel    = n.id === state.selectedId;
    const hasOvr = state.overrides.has(n.id) && !n.isRoot;
    const r      = NODE_R / state.zoom;

    if (sel) {
      ctx.beginPath();
      ctx.arc(n.wx, n.wy, (NODE_R + 4) / state.zoom, 0, Math.PI * 2);
      ctx.strokeStyle = '#1D9E75';
      ctx.lineWidth   = 1.5 / state.zoom;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(n.wx, n.wy, r, 0, Math.PI * 2);
    if (n.isRoot || hasOvr) {
      ctx.fillStyle = '#1D9E75';
      ctx.fill();
    } else {
      ctx.fillStyle   = '#fff';
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth   = 1 / state.zoom;
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore();

  // Labels — screen-space, constant size
  ctx.save();
  ctx.scale(d, d);
  for (const n of state.nodes) {
    const sx = n.wx * state.zoom + state.pan.x;
    const sy = n.wy * state.zoom + state.pan.y;

    if (n.isLeaf) {
      ctx.font      = '11px monospace';
      ctx.fillStyle = '#444';
      ctx.fillText(n.name, sx + 8, sy + 4);
    } else {
      // const mdl   = resolveModel(n.id);
      const ind   = resolveIndel(n.id);
      const label = (ind.enabled ? ' · indel' : '');
      ctx.font      = '10px monospace';
      ctx.fillStyle = '#bbb';
      ctx.fillText(label, sx + 6, sy - 5);
    }
  }
  ctx.restore();
  // Scale bar (screen-space)
  drawBranchScale();
}

// Draw branch-length scale in bottom-right above DOM legend
function drawBranchScale() {
  if (!state.nodes.length) return;
  const wrap = canvas.parentElement;
  const legend = document.getElementById('canvas-legend');
  if (!legend) return;

  const d = dpr();
  // CSS pixels width available for tree drawing
  const maxX  = Math.max(...state.nodes.map(n => n.x)) || 1;
  const drawW = lw() - PAD_LEFT - PAD_RIGHT;
  const pxPerWorld = (drawW / maxX) * state.zoom; // CSS px per world-x unit
  if (!isFinite(pxPerWorld) || pxPerWorld <= 0) return;

  // fixed visual width for box/line in CSS px (only label changes)
  const widthPx = Math.max(60, Math.min(160, wrap.clientWidth * 0.18));

  // compute world length corresponding to that visual width
  let worldLen = widthPx / pxPerWorld;

  // Nice rounding for label only: 1,2,5 * 10^n
  const pow = Math.pow(10, Math.floor(Math.log10(worldLen)));
  const mant = worldLen / pow;
  let niceMant = 1;
  if (mant >= 5) niceMant = 5;
  else if (mant >= 2) niceMant = 2;
  const niceWorldLen = niceMant * pow;

  // Position: align flush-right above DOM legend (match legend right:12px)
  const wrapRect = wrap.getBoundingClientRect();
  const legendRect = legend.getBoundingClientRect();
  const margin = 12; // same as CSS for #canvas-legend right:12px

  // background box dims
  const pad = 6;
  const boxW = widthPx + pad * 2;
  const boxH = 28;

  // place box so its right edge sits `margin` px from wrap right, and bottom sits above legend with small gap
  const boxX = margin;
  const legendTopRel = legendRect.top - wrapRect.top;
  const boxY = Math.max(margin, legendTopRel - margin - boxH);

  // line coordinates inside box
  const x = boxX + pad;
  const y = boxY + boxH / 2 + 2; // baseline y for line

  // Draw on canvas in screen-space (scale by d)
  ctx.save();
  ctx.scale(d, d);

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  roundRect(ctx, boxX, boxY, boxW, boxH, 6);
  ctx.fill();
  ctx.stroke();

  // scale line
  ctx.beginPath();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  const lx = x;
  const rx = x + widthPx;
  const ly = y;
  ctx.moveTo(lx, ly);
  ctx.lineTo(rx, ly);
  ctx.moveTo(lx, ly - 6);
  ctx.lineTo(lx, ly + 6);
  ctx.moveTo(rx, ly - 6);
  ctx.lineTo(rx, ly + 6);
  ctx.stroke();

  // label
  ctx.font = '11px monospace';
  ctx.fillStyle = '#333';
  const label = (+niceWorldLen.toPrecision(4)).toString();
  const tx = boxX + boxW / 2;
  const ty = boxY + 10;
  ctx.textAlign = 'center';
  ctx.fillText(label, tx, ty + 4);

  ctx.restore();
}

// helper: rounded rect path
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── Hit test ──────────────────────────────────────────────────────────────────
function hitTest(sx, sy) {
  let closest = null, minD = Infinity;
  for (const n of state.nodes) {
    const nx = n.wx * state.zoom + state.pan.x;
    const ny = n.wy * state.zoom + state.pan.y;
    const d  = Math.sqrt((sx - nx) ** 2 + (sy - ny) ** 2);
    if (d < HIT_R && d < minD) { minD = d; closest = n.id; }
  }
  if (closest !== state.selectedId) {
    state.selectedId = closest;
    render();
    _onSelect?.();
  }
}

// ── Pan / Zoom ────────────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', e => {
  state.drag = { sx: e.clientX, sy: e.clientY, px: state.pan.x, py: state.pan.y, moved: false };
  canvas.classList.add('panning');
});

window.addEventListener('mousemove', e => {
  if (!state.drag) return;
  const dx = e.clientX - state.drag.sx, dy = e.clientY - state.drag.sy;
  if (Math.sqrt(dx * dx + dy * dy) > 3) state.drag.moved = true;
  state.pan.x = state.drag.px + dx;
  state.pan.y = state.drag.py + dy;
  render();
});

window.addEventListener('mouseup', e => {
  if (!state.drag) return;
  if (!state.drag.moved) {
    const rect = canvas.getBoundingClientRect();
    hitTest(e.clientX - rect.left, e.clientY - rect.top);
  }
  state.drag = null;
  canvas.classList.remove('panning');
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const f  = e.deltaY < 0 ? 1.1 : 0.9;
  state.pan.x = mx - (mx - state.pan.x) * f;
  state.pan.y = my - (my - state.pan.y) * f;
  state.zoom  = Math.max(0.05, Math.min(80, state.zoom * f));
  render();
}, { passive: false });

// ── Resize observer ───────────────────────────────────────────────────────────
new ResizeObserver(() => {
  resizeCanvas();
  if (state.nodes.length) { computeWXY(); render(); }
}).observe(canvas.parentElement);
