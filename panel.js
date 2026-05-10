import { state, ALL_MODELS } from './state.js';
import {
  resolveModelFull, resolveIndel, resolveSource,
  ensureOverride, dropOverrideKey, resetSubtree,
  getLeafNames, nodeName,
} from './tree.js';
import { render } from './canvas.js';

const panelPH   = document.getElementById('panel-placeholder');
const panelBody = document.getElementById('panel-content');

export function renderPanel() {
  if (state.selectedId === null) {
    panelPH.style.display  = 'flex';
    panelBody.style.display = 'none';
    return;
  }
  panelPH.style.display  = 'none';
  panelBody.style.display = 'flex';

  const n         = state.nodes[state.selectedId];
  const isRoot    = n.isRoot;
  const hasModOvr = !!state.overrides.get(state.selectedId)?.model;
  const hasIndOvr = !!state.overrides.get(state.selectedId)?.indel;
  const modInherit = !isRoot && !hasModOvr;
  const indInherit = !isRoot && !hasIndOvr;

  const rMod = resolveModelFull(state.selectedId);
  const rInd = resolveIndel(state.selectedId);

  const modSrcId   = modInherit ? resolveSource(state.selectedId, 'model') : null;
  const indSrcId   = indInherit ? resolveSource(state.selectedId, 'indel') : null;
  const modSrcName = modSrcId !== null ? nodeName(modSrcId) : 'defaults';
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

  const modelOpts = ALL_MODELS.map(m =>
    `<option value="${m}"${rMod.name === m ? ' selected' : ''}>${m}</option>`
  ).join('');

  panelBody.innerHTML = `
    <div class="psec">
      <div class="plabel">node</div>
      <div class="pname">${n.name || (isRoot ? 'Root' : `Node ${n.id}`)}</div>
      <div class="pmeta">${metaParts.join(' · ')}</div>
    </div>

    <div class="psec">
      <div class="sec-head"><span class="sec-title">Substitution model</span></div>
      ${!isRoot ? `
      <div class="inherit-row">
        <span class="inherit-label">inherit from parent</span>
        <label class="tog">
          <input type="checkbox" id="mod-inh"${modInherit ? ' checked' : ''}>
          <div class="tog-track"></div><div class="tog-thumb"></div>
        </label>
      </div>` : ''}
      <div class="fgroup${modInherit ? ' inh' : ''}" id="mod-fields">
        <div class="field">
          <label>Model${modInherit ? `<span class="inh-src">↑ ${modSrcName}</span>` : ''}</label>
          <select id="mod-sel"${modInherit ? ' disabled' : ''}>${modelOpts}</select>
        </div>
        ${!isRoot && hasModOvr ? `<div style="font-size:10px;color:#bbb;margin-top:2px;line-height:1.4">Per-clade substitution models not yet applied in simulation — root model is used.</div>` : ''}
        ${isRoot ? `
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
        </div>` : ''}
      </div>
    </div>

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
        <div class="field">
          <label>Deletion rate</label>
          <input type="number" id="del-rate" value="${rInd.deletionRate}" min="0" max="1" step="0.01"${indInherit ? ' disabled' : ''}/>
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
  document.getElementById('mod-inh')?.addEventListener('change', e => {
    if (e.target.checked) dropOverrideKey(state.selectedId, 'model');
    else ensureOverride(state.selectedId, 'model');
    renderPanel(); render();
  });

  document.getElementById('ind-inh')?.addEventListener('change', e => {
    if (e.target.checked) dropOverrideKey(state.selectedId, 'indel');
    else ensureOverride(state.selectedId, 'indel');
    renderPanel(); render();
  });

  document.getElementById('mod-sel')?.addEventListener('change', e => {
    ensureOverride(state.selectedId, 'model');
    state.overrides.get(state.selectedId).model.name = e.target.value;
    render();
  });

  document.getElementById('seq-len')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'model');
    state.overrides.get(state.selectedId).model.seqLen = parseInt(e.target.value) || 100;
  });

  document.getElementById('seed-val')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'model');
    state.overrides.get(state.selectedId).model.seed = parseInt(e.target.value) || 42;
  });

  document.getElementById('root-seq')?.addEventListener('input', e => {
    state.rootSeq = e.target.value.trim();
    // sync seq-len to root sequence length when non-empty
    if (state.rootSeq) {
      const seqLenInput = document.getElementById('seq-len');
      if (seqLenInput) {
        seqLenInput.value = state.rootSeq.length;
        ensureOverride(state.selectedId, 'model');
        state.overrides.get(state.selectedId).model.seqLen = state.rootSeq.length;
      }
    }
  });

  document.getElementById('ind-on')?.addEventListener('change', e => {
    ensureOverride(state.selectedId, 'indel');
    state.overrides.get(state.selectedId).indel.enabled = e.target.checked;
    render();
  });

  document.getElementById('ins-rate')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'indel');
    state.overrides.get(state.selectedId).indel.insertionRate = parseFloat(e.target.value) || 0;
  });

  document.getElementById('del-rate')?.addEventListener('input', e => {
    ensureOverride(state.selectedId, 'indel');
    state.overrides.get(state.selectedId).indel.deletionRate = parseFloat(e.target.value) || 0;
  });

  document.getElementById('reset-sub')?.addEventListener('click', () => {
    resetSubtree(state.selectedId);
    renderPanel();
    render();
  });
}