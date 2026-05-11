import { state, ALL_MODELS } from './state.js';
import {
  resolveModelFull, resolveIndel, resolveSource,
  ensureOverride, dropOverrideKey, resetSubtree,
  getLeafNames, nodeName,
} from './tree.js';
import { render } from './canvas.js';
import { scheduleAutoRun } from './sim.js';

const panelPH   = document.getElementById('panel-placeholder');
const panelBody = document.getElementById('panel-content');

// ── Distribution fields helper ────────────────────────────────────────────────
function distBlock(prefix, dist, geomP, zipfA, disabled) {
  const dis  = disabled ? ' disabled' : '';
  const geom = dist === 'geometric';
  return `
    <div class="field">
      <label>${prefix === 'ins' ? 'Insertion' : 'Deletion'} length distribution</label>
      <select id="${prefix}-dist"${dis}>
        <option value="geometric"${geom  ? ' selected' : ''}>Geometric</option>
        <option value="zipf"     ${!geom ? ' selected' : ''}>Zipf</option>
      </select>
    </div>
    <div class="field">
      <label>${geom ? 'p (geometric, 0–1)' : 'a (Zipf exponent)'}</label>
      <input type="number" id="${prefix}-dist-param"
        value="${geom ? geomP : zipfA}"
        min="${geom ? '0.01' : '1.01'}"
        max="${geom ? '0.99' : ''}"
        step="${geom ? '0.01' : '0.1'}"${dis}/>
    </div>`;
}

// ── Rate variation fields (root only) ─────────────────────────────────────────
function rateVarBlock(rMod, indelOn) {
  const rv  = rMod.rateVarEnabled;
  const cor = rMod.correlation > 0;
  // invariant: only when no correlation and not indel-aware
  const showInvar        = rv && !cor && !rMod.indelAwareRates;
  // indel-aware toggle: only when rate var on, correlation > 0, indels active
  const showIndelAware   = rv && cor && indelOn;

  return `
    <div class="field" style="display:flex;align-items:center;justify-content:space-between">
      <label style="margin:0">Enable rate variation</label>
      <label class="tog">
        <input type="checkbox" id="rate-var-on"${rv ? ' checked' : ''}>
        <div class="tog-track"></div><div class="tog-thumb"></div>
      </label>
    </div>
    ${rv ? `
    <div class="field">
      <label>Categories</label>
      <input type="number" id="gamma-cats" value="${rMod.gammaCategories}" min="2" max="32" step="1"/>
    </div>
    <div class="field">
      <label>Alpha (shape)</label>
      <input type="number" id="gamma-alpha" value="${rMod.gammaAlpha}" min="0.01" step="0.1"/>
    </div>
    <div class="field">
      <label>Correlation ρ <span style="color:#bbb;font-size:10px">(0 = independent)</span></label>
      <input type="number" id="rate-corr" value="${rMod.correlation}" min="0" max="0.999" step="0.05"/>
    </div>
    ${showInvar ? `
    <div class="field">
      <label>Invariant proportion</label>
      <input type="number" id="invar-prop" value="${rMod.invarProp}" min="0" max="0.999" step="0.05"/>
    </div>` : ''}
    ${showIndelAware ? `
    <div class="field" style="display:flex;align-items:center;justify-content:space-between">
      <label style="margin:0">Indel-aware rates</label>
      <label class="tog">
        <input type="checkbox" id="indel-aware-rates"${rMod.indelAwareRates ? ' checked' : ''}>
        <div class="tog-track"></div><div class="tog-thumb"></div>
      </label>
    </div>` : ''}
    ` : ''}`;
}

export function renderPanel() {
  if (state.selectedId === null) {
    panelPH.style.display  = 'flex';
    panelBody.style.display = 'none';
    return;
  }
  panelPH.style.display  = 'none';
  panelBody.style.display = 'flex';

  const n      = state.nodes[state.selectedId];
  const isRoot = n.isRoot;

  const hasIndOvr  = !!state.overrides.get(state.selectedId)?.indel;
  const indInherit = !isRoot && !hasIndOvr;

  const rMod = resolveModelFull(state.selectedId);
  const rInd = resolveIndel(state.selectedId);

  const indSrcId   = indInherit ? resolveSource(state.selectedId, 'indel') : null;
  const indSrcName = indSrcId !== null ? nodeName(indSrcId) : 'defaults';

  const leafNames   = !n.isLeaf ? getLeafNames(state.selectedId) : [];
  const leafPreview = leafNames.length <= 4
    ? leafNames.join(', ')
    : leafNames.slice(0, 4).join(', ') + ` … +${leafNames.length - 4} more`;

  const metaParts = [
    isRoot ? 'root' : n.isLeaf ? 'leaf' : 'internal',
    `${n.isLeaf ? 1 : leafNames.length} ${leafNames.length === 1 ? 'leaf' : 'leaves'}`,
  ];
  if (!isRoot) metaParts.push(`branch ${n.branchLen.toFixed(4)}`);

  // indels enabled on any node → indel-aware rates toggle is relevant
  const indelOn = state.nodes.some(nd => resolveIndel(nd.id).enabled);

  const modelOpts = ALL_MODELS.map(m =>
    `<option value="${m}"${rMod.name === m ? ' selected' : ''}>${m}</option>`
  ).join('');

  panelBody.innerHTML = `
    <div class="psec">
      <div class="plabel">node</div>
      <div class="pname">${n.name || (isRoot ? 'Root' : `Node ${n.id}`)}</div>
      <div class="pmeta">${metaParts.join(' · ')}</div>
    </div>

    ${isRoot ? `
    <div class="psec">
      <div class="sec-head"><span class="sec-title">Substitution model</span></div>
      <div class="fgroup" id="mod-fields">
        <div class="field">
          <label>Model</label>
          <select id="mod-sel">${modelOpts}</select>
        </div>
        <div class="field">
          <label>Sequence length</label>
          <input type="number" id="seq-len" value="${rMod.seqLen}" min="1" max="5000"/>
        </div>
        <div class="field">
          <label>Random seed</label>
          <input type="number" id="seed-val" value="${rMod.seed}"/>
        </div>
        <div class="field">
          <label>Root sequence <span style="color:#bbb;font-size:10px">(optional — overrides length)</span></label>
          <textarea id="root-seq" rows="3"
            style="width:100%;font-family:monospace;font-size:11px;padding:4px 7px;border:1px solid #e0e0e0;border-radius:4px;background:#fff;color:#1a1a1a;resize:vertical"
            placeholder="Leave blank for random…">${state.rootSeq}</textarea>
        </div>
        ${rateVarBlock(rMod, indelOn)}
      </div>
    </div>` : ''}

    <div class="psec">
      <div class="sec-head"><span class="sec-title">Indels</span></div>
      ${!isRoot ? `
      <div class="inherit-row">
        <span class="inherit-label">inherit from parent</span>
        <label class="tog">
          <input type="checkbox" id="ind-inh"${indInherit ? ' checked' : ''}>
          <div class="tog-track"></div><div class="tog-thumb"></div>
        </label>
      </div>` : ''}
      <div class="fgroup${indInherit ? ' inh' : ''}" id="ind-fields">
        <div class="field">
          <label>
            <input type="checkbox" id="ind-on"${rInd.enabled ? ' checked' : ''}${indInherit ? ' disabled' : ''}/>
            Enable${indInherit ? `<span class="inh-src">↑ ${indSrcName}</span>` : ''}
          </label>
        </div>
        <div class="field">
          <label>Insertion rate</label>
          <input type="number" id="ins-rate" value="${rInd.insertionRate}" min="0" max="1" step="0.01"${indInherit ? ' disabled' : ''}/>
        </div>
        ${distBlock('ins', rInd.insDist, rInd.insGeomP, rInd.insZipfA, indInherit)}
        <div class="field" style="margin-top:6px">
          <label>Deletion rate</label>
          <input type="number" id="del-rate" value="${rInd.deletionRate}" min="0" max="1" step="0.01"${indInherit ? ' disabled' : ''}/>
        </div>
        ${distBlock('del', rInd.delDist, rInd.delGeomP, rInd.delZipfA, indInherit)}
        <div class="field" style="margin-top:6px">
          <label>Max indel length</label>
          <input type="number" id="max-indel-len" value="${rInd.maxIndelLen}" min="1" max="200" step="1"${indInherit ? ' disabled' : ''}/>
        </div>
      </div>
    </div>

    ${!n.isLeaf ? `
    <div class="psec">
      <div class="plabel">subtree</div>
      <div class="subtree-note">
        Propagates to<br>
        <span class="subtree-names">${leafPreview}</span>
      </div>
      ${!isRoot ? `<button class="btn" id="reset-sub" style="width:100%;font-size:11px;margin-top:2px">reset subtree overrides</button>` : ''}
    </div>` : ''}
  `;

  // ── Events ────────────────────────────────────────────────────────────────

  // Root-only substitution model events
  document.getElementById('mod-sel')?.addEventListener('change', e => {
    ensureOverride(state.selectedId, 'model');
    state.overrides.get(state.selectedId).model.name = e.target.value;
    render(); scheduleAutoRun();
  });

  document.getElementById('seq-len')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'model');
    state.overrides.get(state.selectedId).model.seqLen = parseInt(e.target.value) || 100;
    scheduleAutoRun();
  });

  document.getElementById('seed-val')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'model');
    state.overrides.get(state.selectedId).model.seed = parseInt(e.target.value) || 42;
    scheduleAutoRun();
  });

  document.getElementById('root-seq')?.addEventListener('input', e => {
    state.rootSeq = e.target.value.trim();
    if (state.rootSeq) {
      const seqLenInput = document.getElementById('seq-len');
      if (seqLenInput) {
        seqLenInput.value = state.rootSeq.length;
        ensureOverride(state.selectedId, 'model');
        state.overrides.get(state.selectedId).model.seqLen = state.rootSeq.length;
      }
    }
    scheduleAutoRun();
  });

  // Rate variation events (root only)
  document.getElementById('rate-var-on')?.addEventListener('change', e => {
    ensureOverride(state.selectedId, 'model');
    state.overrides.get(state.selectedId).model.rateVarEnabled = e.target.checked;
    if (!e.target.checked) {
      const m = state.overrides.get(state.selectedId).model;
      m.indelAwareRates = false;
    }
    renderPanel(); scheduleAutoRun();
  });

  document.getElementById('gamma-cats')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'model');
    state.overrides.get(state.selectedId).model.gammaCategories = Math.max(2, parseInt(e.target.value) || 4);
    scheduleAutoRun();
  });

  document.getElementById('gamma-alpha')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'model');
    state.overrides.get(state.selectedId).model.gammaAlpha = parseFloat(e.target.value) || 1.0;
    scheduleAutoRun();
  });

  document.getElementById('rate-corr')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'model');
    const m   = state.overrides.get(state.selectedId).model;
    m.correlation = Math.min(0.999, Math.max(0, parseFloat(e.target.value) || 0));
    if (!(m.correlation > 0)) m.indelAwareRates = false;
    renderPanel(); scheduleAutoRun();
  });

  document.getElementById('invar-prop')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'model');
    state.overrides.get(state.selectedId).model.invarProp =
      Math.min(0.999, Math.max(0, parseFloat(e.target.value) || 0));
    scheduleAutoRun();
  });

  document.getElementById('indel-aware-rates')?.addEventListener('change', e => {
    ensureOverride(state.selectedId, 'model');
    state.overrides.get(state.selectedId).model.indelAwareRates = e.target.checked;
    renderPanel(); scheduleAutoRun();
  });

  // Indel events (all nodes)
  document.getElementById('ind-inh')?.addEventListener('change', e => {
    if (e.target.checked) dropOverrideKey(state.selectedId, 'indel');
    else ensureOverride(state.selectedId, 'indel');
    renderPanel(); render(); scheduleAutoRun();
  });

  document.getElementById('ind-on')?.addEventListener('change', e => {
    ensureOverride(state.selectedId, 'indel');
    state.overrides.get(state.selectedId).indel.enabled = e.target.checked;
    render(); scheduleAutoRun();
  });

  document.getElementById('ins-rate')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'indel');
    state.overrides.get(state.selectedId).indel.insertionRate = parseFloat(e.target.value) || 0;
    scheduleAutoRun();
  });

  document.getElementById('ins-dist')?.addEventListener('change', e => {
    ensureOverride(state.selectedId, 'indel');
    state.overrides.get(state.selectedId).indel.insDist = e.target.value;
    renderPanel(); scheduleAutoRun();
  });

  document.getElementById('ins-dist-param')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'indel');
    const ind = state.overrides.get(state.selectedId).indel;
    const val = parseFloat(e.target.value);
    if (ind.insDist === 'zipf') ind.insZipfA = val || 2.0;
    else                        ind.insGeomP = val || 0.5;
    scheduleAutoRun();
  });

  document.getElementById('del-rate')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'indel');
    state.overrides.get(state.selectedId).indel.deletionRate = parseFloat(e.target.value) || 0;
    scheduleAutoRun();
  });

  document.getElementById('del-dist')?.addEventListener('change', e => {
    ensureOverride(state.selectedId, 'indel');
    state.overrides.get(state.selectedId).indel.delDist = e.target.value;
    renderPanel(); scheduleAutoRun();
  });

  document.getElementById('del-dist-param')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'indel');
    const ind = state.overrides.get(state.selectedId).indel;
    const val = parseFloat(e.target.value);
    if (ind.delDist === 'zipf') ind.delZipfA = val || 2.0;
    else                        ind.delGeomP = val || 0.5;
    scheduleAutoRun();
  });

  document.getElementById('max-indel-len')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'indel');
    state.overrides.get(state.selectedId).indel.maxIndelLen = parseInt(e.target.value) || 20;
    scheduleAutoRun();
  });

  document.getElementById('reset-sub')?.addEventListener('click', () => {
    resetSubtree(state.selectedId);
    renderPanel();
    render();
  });
}