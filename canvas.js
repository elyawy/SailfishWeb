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
      const mdl   = resolveModel(n.id);
      const ind   = resolveIndel(n.id);
      const label = mdl + (ind.enabled ? ' · indel' : '');
      ctx.font      = '10px monospace';
      ctx.fillStyle = '#bbb';
      ctx.fillText(label, sx + 6, sy - 5);
    }
  }
  ctx.restore();
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
