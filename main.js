import createSailfish from './dist/sailfish.js';
import { state, DEF_MODEL, DEF_INDEL } from './state.js';
import { buildLayout } from './tree.js';
import { render, resizeCanvas, fitToView, setOnSelect } from './canvas.js';
import { renderPanel } from './panel.js';
import { runSim, showOutput, downloadFasta } from './sim.js';

const parseBtn    = document.getElementById('parse-btn');
const runBtn      = document.getElementById('run-btn');
const newickInput = document.getElementById('newick-input');
const statusDot   = document.getElementById('status-dot');
const noTreeMsg   = document.getElementById('no-tree-msg');
const panelPH     = document.getElementById('panel-placeholder');
const panelBody   = document.getElementById('panel-content');
const outPanel    = document.getElementById('output-panel');

// Wire node selection → panel update
setOnSelect(renderPanel);

// ── WASM init ─────────────────────────────────────────────────────────────────
createSailfish().then(m => {
  state.M = m;
  statusDot.className = 'ready';
  statusDot.title     = 'WASM ready';
  parseBtn.disabled   = false;
}).catch(e => {
  statusDot.className = 'error';
  statusDot.title     = 'WASM failed: ' + e.message;
});

// ── Parse ─────────────────────────────────────────────────────────────────────
parseBtn.addEventListener('click', () => {
  const newick = newickInput.value.trim();
  if (!newick || !state.M) return;

  if (state.wasmTree) { try { state.wasmTree.delete(); } catch (_) {} }
  state.overrides.clear();
  state.selectedId = null;

  try {
    state.wasmTree = new state.M.Tree(newick, false);
    state.nodes    = buildLayout(state.wasmTree);

    const root = state.nodes.find(n => n.isRoot);
    state.overrides.set(root.id, { model: { ...DEF_MODEL }, indel: { ...DEF_INDEL } });

    noTreeMsg.style.display  = 'none';
    panelPH.textContent      = 'Click a node\nto edit its model';
    panelPH.style.display    = 'flex';
    panelBody.style.display  = 'none';
    fitToView();
    render();
    runBtn.disabled = false;
  } catch (e) {
    alert('Parse error: ' + e.message);
  }
});

// ── Run ───────────────────────────────────────────────────────────────────────
runBtn.addEventListener('click', runSim);

// ── Output panel ──────────────────────────────────────────────────────────────
document.getElementById('out-close').addEventListener('click', () => outPanel.classList.remove('open'));

document.getElementById('dl-btn').addEventListener('click', () => {
  if (state.lastOutput) downloadFasta(state.lastOutput, 'sailfish_msa.fasta');
});

// ── Init ──────────────────────────────────────────────────────────────────────
resizeCanvas();
