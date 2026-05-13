import { state, AMINO_MODELS } from './state.js';
import { resolveModelFull, resolveIndel } from './tree.js';
import { buildRateModel } from './gamma.js';

const runBtn   = document.getElementById('run-btn');
const outPanel = document.getElementById('output-panel');
const outBody  = document.getElementById('out-body');

// ── Output helpers ────────────────────────────────────────────────────────────
export function showOutput(text) {
  outBody.textContent = text;
  outPanel.classList.add('open');
}

export function downloadFasta(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Parse MSA row ─────────────────────────────────────────────────────────────
function parseRow(raw) {
  const row = raw.trimEnd();
  if (row.startsWith('>')) {
    const nl = row.indexOf('\n');
    if (nl > 0) return { name: row.slice(1, nl).trim(), seq: row.slice(nl + 1).trim() };
  }
  const ci = row.indexOf(':'), ti = row.indexOf('\t'), si = row.indexOf(' ');
  if (ci > 0) return { name: row.slice(0, ci).trim(), seq: row.slice(ci + 1).trim() };
  if (ti > 0) return { name: row.slice(0, ti),        seq: row.slice(ti + 1) };
  if (si > 0) return { name: row.slice(0, si),        seq: row.slice(si + 1) };
  return { name: null, seq: row };
}

// ── DFS pre-order edge walk ───────────────────────────────────────────────────
function dfsEdgeOrder(nodes) {
  const root = nodes.find(n => n.isRoot);
  const order = [];
  function walk(id) {
    const n = nodes[id];
    if (!n.isRoot) order.push(id);
    for (const childId of n.children) walk(childId);
  }
  walk(root.id);
  return order;
}

// ── Indel length distribution builder ────────────────────────────────────────
function buildDistProbs(distType, geomP, zipfA, maxLen) {
  const probs = [];
  console.log(`Building ${distType} distribution with maxLen=${maxLen}, geomP=${geomP}, zipfA=${zipfA}`);
  if (distType === 'zipf') {
    for (let k = 1; k <= maxLen; k++) probs.push(1 / Math.pow(k, zipfA));
  } else {
    for (let k = 1; k <= maxLen; k++) probs.push(Math.pow(1 - geomP, k - 1) * geomP);
  }
  const sum = probs.reduce((a, b) => a + b, 0);
  console.log(probs.map(p => p / sum))
  return probs.map(p => p / sum);
}

// ── Apply rate model to factory ───────────────────────────────────────────────
// Builds WASM vectors from buildRateModel output and calls the factory.
// Uses set_site_rate_model (with matrix) when correlation > 0, _no_matrix otherwise.
function applyRateModel(factory, rMod, M, track) {
  const { rates, probs, matrix } = buildRateModel(rMod, M);

  const ratesVec = track(new M.DoubleVector());
  rates.forEach(r => ratesVec.push_back(r));
  const probsVec = track(new M.DoubleVector());
  probs.forEach(p => probsVec.push_back(p));

  if (rMod.rateVarEnabled && rMod.correlation > 0) {
    const matVec = track(new M.DoubleMatrix());
    for (const row of matrix) {
      const rowVec = new M.DoubleVector();
      row.forEach(v => rowVec.push_back(v));
      matVec.push_back(rowVec);
      rowVec.delete();
    }
    factory.set_site_rate_model(ratesVec, probsVec, matVec);
  } else {
    factory.set_site_rate_model_no_matrix(ratesVec, probsVec);
  }
}

// ── Single run ────────────────────────────────────────────────────────────────
export function runOnce(seed, rMod, rInd) {
  const { M, wasmTree } = state;
  const modelName = rMod.name;
  const seqLen    = rMod.seqLen;
  const isAmino   = AMINO_MODELS.has(modelName);
  const indelOn   = state.nodes.some(n => resolveIndel(n.id).enabled);
  const isSaveRoot  = state.saveRoot;

  const toDelete = [];
  const track = o => { toDelete.push(o); return o; };

  try {
    const simCtx = track(M.createSimulationContext(wasmTree, seed));
    const factory = track(new M.modelFactory());
    factory.set_replacement_model(M.modelCode[modelName]);
    applyRateModel(factory, rMod, M, track);
    factory.build_replacement_model();

    if (isSaveRoot) {
      simCtx.set_save_root();
    }

    const sim = track(isAmino
      ? M.createAminoSim(factory, simCtx)
      : M.createNucleotideSim(factory, simCtx));

    let msa;
    if (indelOn) {
      const numEdges  = wasmTree.num_nodes - 1;
      const edgeOrder = dfsEdgeOrder(state.nodes);
      const maxLen    = rInd.maxIndelLen;

      const insRates = track(new M.DoubleVector());
      const delRates = track(new M.DoubleVector());
      const insDists = [];
      const delDists = [];

      for (const nodeId of edgeOrder) {
        const eInd = resolveIndel(nodeId);
        console.log(`Edge ${nodeId}: indel enabled=${eInd.enabled} insRate=${eInd.insertionRate} delRate=${eInd.deletionRate} insDist=${eInd.insDist} delDist=${eInd.delDist}`);
        insRates.push_back(eInd.enabled ? eInd.insertionRate : 0);
        delRates.push_back(eInd.enabled ? eInd.deletionRate  : 0);

        const insVec = track(new M.DoubleVector());
        buildDistProbs(eInd.insDist, eInd.insGeomP, eInd.insZipfA, maxLen).forEach(p => insVec.push_back(p));
        insDists.push(track(new M.DiscreteDistribution(insVec)));

        const delVec = track(new M.DoubleVector());
        buildDistProbs(eInd.delDist, eInd.delGeomP, eInd.delZipfA, maxLen).forEach(p => delVec.push_back(p));
        delDists.push(track(new M.DiscreteDistribution(delVec)));
      }

      const protocol = track(new M.SimProtocol(numEdges));
      protocol.set_sequence_size(seqLen);
      protocol.set_minimum_sequence_size(Math.max(1, Math.floor(seqLen / 10)));
      protocol.set_max_insertion_length(maxLen);
      protocol.set_insertion_rates(insRates);
      protocol.set_deletion_rates(delRates);
      protocol.set_insertion_length_distributions(insDists, numEdges);
      protocol.set_deletion_length_distributions(delDists, numEdges);

      // INDEL_AWARE: rate categories correlated with indel history.
      // Only active when rate variation + correlation > 0 + user opted in.
      if (rMod.rateVarEnabled && rMod.correlation > 0 && rMod.indelAwareRates) {
        protocol.set_site_rate_model(M.SiteRateModel.INDEL_AWARE);
        const catSampler = track(factory.get_rate_category_sampler(protocol.get_max_insertion_length()));
        simCtx.set_category_sampler(catSampler);
      }

      simCtx.set_protocol(protocol);
      const indelSim = track(new M.IndelSimulator(simCtx, protocol));
      const eventMap = track(indelSim.generate_events());
      msa = track(M.createMsaFromEvents(eventMap, simCtx));

      sim.set_aligned_sequence_map(msa);

      if (rMod.rateVarEnabled && rMod.correlation > 0 && rMod.indelAwareRates) {
        const rateCats = track(msa.get_per_site_rate_categories());
        sim.set_per_site_rate_categories(rateCats);
      }
    } else {
      msa = track(M.createMsaFromLength(seqLen, simCtx));
      sim.set_aligned_sequence_map(msa);
    }

    const msaLen    = msa.length();
    const container = state.rootSeq
      ? track(sim.simulate_substitutions_with_root(msaLen, state.rootSeq, msa.get_root_positions_in_msa()))
      : track(sim.simulate_substitutions(msaLen));
    msa.fill_substitutions(container);

    const nSeq = msa.num_sequences();
    const rows = [];
    for (let i = 0; i < nSeq; i++) rows.push(parseRow(msa.get_msa_row_string(i)));
    return { rows, msaLen, modelName, indelOn, nSeq };

  } finally {
    toDelete.reverse().forEach(o => { try { o.delete(); } catch (_) {} });
  }
}

// ── Auto-run (nRuns = 1) ──────────────────────────────────────────────────────
let _autoRunTimer = null;
export function scheduleAutoRun() {
  const nRuns = parseInt(document.getElementById('n-runs')?.value) || 1;
  if (nRuns !== 1) return;
  clearTimeout(_autoRunTimer);
  _autoRunTimer = setTimeout(runSim, 100);
}

// ── Run simulation ────────────────────────────────────────────────────────────
export function runSim() {
  if (!state.wasmTree || !state.M) return;
  runBtn.disabled    = true;
  runBtn.textContent = 'Running…';

  const root  = state.nodes.find(n => n.isRoot);
  const rMod  = resolveModelFull(root.id);
  const rInd  = resolveIndel(root.id);
  const nRuns = Math.max(1, parseInt(document.getElementById('n-runs').value) || 1);
  const toFile = nRuns > 1;

  try {
    let fasta = '', viewText = '', lastResult;

    const t0 = performance.now();

    for (let r = 0; r < nRuns; r++) {
      const result = runOnce(rMod.seed + r, rMod, rInd);
      lastResult   = result;

      // If row.name is `N1` replace with Root
      for (const row of result.rows) {
        if (row.name === 'N1') row.name = 'Root';
        fasta += `>${row.name}\n${row.seq}\n`;
      }
      fasta += '\n';

      if (!toFile) {
        if (r > 0) viewText += '\n' + '─'.repeat(64) + '\n';
        viewText += `Run ${r + 1} — Model: ${result.modelName}  Indels: ${result.indelOn}  MSA: ${result.msaLen}  Seed: ${rMod.seed + r}\n`;
        viewText += '─'.repeat(64) + '\n';
        for (const row of result.rows) viewText += `>${row.name}\n${row.seq}\n`;
      }
    }

    const elapsed = ((performance.now() - t0) / 1000).toFixed(3);


    state.lastOutput = fasta;

    if (toFile) {
      downloadFasta(fasta, `sailfish_${nRuns}runs.fasta`);
      showOutput(`Simulation time: ${elapsed}s\n` + '─'.repeat(64) + '\n' + `${nRuns} runs completed.\nModel: ${rMod.name}  |  Indels: ${rInd.enabled}  |  MSA length: ${lastResult.msaLen}\nSeeds: ${rMod.seed}–${rMod.seed + nRuns - 1}\n\nSaved to sailfish_${nRuns}runs.fasta`);
    } else {
      showOutput(`Simulation time: ${elapsed}s\n` + '─'.repeat(64) + '\n' + viewText);
    }

  } catch (e) {
    showOutput('Error: ' + e.message);
    console.error(e);
  } finally {
    runBtn.disabled    = false;
    runBtn.textContent = 'Run ▶';
  }
}