import { state, AMINO_MODELS } from './state.js';
import { resolveModelFull, resolveIndel, toNewick, findImmediateModelOverrides } from './tree.js';

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
  const ci  = row.indexOf(':');
  const ti  = row.indexOf('\t');
  const si  = row.indexOf(' ');
  if (ci > 0) return { name: row.slice(0, ci).trim(), seq: row.slice(ci + 1).trim() };
  if (ti > 0) return { name: row.slice(0, ti),        seq: row.slice(ti + 1) };
  if (si > 0) return { name: row.slice(0, si),        seq: row.slice(si + 1) };
  return { name: null, seq: row };
}

// ── DFS pre-order edge walk ───────────────────────────────────────────────────
// Returns non-root node IDs in the order the C++ tree indexes edges (0 = left
// branch of root, then DFS into that subtree, then next child, etc.)
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
// Returns a plain JS array of (unnormalised) probability weights, one per length
// from 1..maxLen. DiscreteDistribution normalises internally.
function buildDistProbs(distType, geomP, zipfA, maxLen) {
  const probs = [];
  if (distType === 'zipf') {
    for (let k = 1; k <= maxLen; k++) probs.push(1 / Math.pow(k, zipfA));
  } else {
    // geometric: P(len = k) ∝ (1-p)^(k-1) * p
    for (let k = 1; k <= maxLen; k++) probs.push(Math.pow(1 - geomP, k - 1) * geomP);
  }
  const sum = probs.reduce((a, b) => a + b, 0);
  return probs.map(p => p / sum);
}

// ── Per-clade substitution simulation ────────────────────────────────────────
// Recursively simulates substitutions for the subtree at nodeId using rMod.
// Writes leaf name → sequence into the shared `results` map.
// Override children are found, their boundary sequences extracted, then
// recursed into with their own models.
function simulateClade(nodeId, rootSeqStr, rMod, seed, results) {
  const { M } = state;
  const overrideChildIds = findImmediateModelOverrides(nodeId);
  const stopAtIds        = new Set(overrideChildIds);

  const newick  = toNewick(nodeId, stopAtIds, true) + ';';
  const seqLen  = rootSeqStr ? rootSeqStr.length : rMod.seqLen;
  const isAmino = AMINO_MODELS.has(rMod.name);

  const toDelete = [];
  const track = o => { toDelete.push(o); return o; };

  try {
    const subTree = track(new M.Tree(newick, false));
    const simCtx  = track(M.createSimulationContext(subTree, seed));
    const factory = track(new M.modelFactory());
    factory.set_replacement_model(M.modelCode[rMod.name]);
    const rates = track(new M.DoubleVector()); rates.push_back(1.0);
    const probs = track(new M.DoubleVector()); probs.push_back(1.0);
    factory.set_site_rate_model_no_matrix(rates, probs);
    factory.build_replacement_model();

    const sim = track(isAmino
      ? M.createAminoSim(factory, simCtx)
      : M.createNucleotideSim(factory, simCtx));

    const msa = track(M.createMsaFromLength(seqLen, simCtx));
    sim.set_aligned_sequence_map(msa);

    const container = rootSeqStr
      ? track(sim.simulate_substitutions_with_root(seqLen, rootSeqStr, msa.get_root_positions_in_msa()))
      : track(sim.simulate_substitutions(seqLen));
    msa.fill_substitutions(container);

    console.log('[simulateClade] newick:', newick);
    console.log('[simulateClade] seqLen:', seqLen);
    console.log('[simulateClade] nSeq:', msa.num_sequences());
    console.log('[simulateClade] results after fill:', { ...results });
    
    const nSeq = msa.num_sequences();
    for (let i = 0; i < nSeq; i++) {
      console.log('[simulateClade] raw row:', msa.get_msa_row_string(i));
      const { name, seq } = parseRow(msa.get_msa_row_string(i));
      if (name) results[name] = seq;
    }

  } finally {
    toDelete.reverse().forEach(o => { try { o.delete(); } catch (_) {} });
  }

  // Recurse after WASM cleanup — we only need the string sequences now.
  for (const childId of overrideChildIds) {
    const childNode = state.nodes[childId];
    const childName = childNode.name || `node_${childId}`;
    const childMod  = resolveModelFull(childId);
    simulateClade(childId, results[childName], childMod, seed + childId, results);
  }
}

// ── Single run ────────────────────────────────────────────────────────────────
export function runOnce(seed, rMod, rInd) {
  const { M, wasmTree } = state;
  const modelName = rMod.name;
  const seqLen    = rMod.seqLen;
  const isAmino   = AMINO_MODELS.has(modelName);
  const indelOn   = state.nodes.some(n => resolveIndel(n.id).enabled);
  const hasModelOverrides = state.nodes.some(n => !n.isRoot && !!state.overrides.get(n.id)?.model);

  // ── Per-clade path: multiple substitution models ──────────────────────────
  if (hasModelOverrides) {
    const root    = state.nodes.find(n => n.isRoot);
    const results = {};
    simulateClade(root.id, state.rootSeq || null, rMod, seed, results);
    const rows   = state.nodes
      .filter(n => n.isLeaf)
      .map(n => ({ name: n.name, seq: results[n.name] || '' }));
    return { rows, msaLen: rows[0]?.seq.length || 0, modelName, indelOn: false, nSeq: rows.length };
  }

  // ── Single-model path (with optional indels) ──────────────────────────────

  const toDelete = [];
  const track = o => { toDelete.push(o); return o; };

  try {
    const simCtx  = track(M.createSimulationContext(wasmTree, seed));
    const factory = track(new M.modelFactory());
    factory.set_replacement_model(M.modelCode[modelName]);
    const rates = track(new M.DoubleVector()); rates.push_back(1.0);
    const probs = track(new M.DoubleVector()); probs.push_back(1.0);
    factory.set_site_rate_model_no_matrix(rates, probs);
    factory.build_replacement_model();

    const sim = track(isAmino
      ? M.createAminoSim(factory, simCtx)
      : M.createNucleotideSim(factory, simCtx));

    let msa;
    if (indelOn) {
      const numEdges   = wasmTree.num_nodes - 1;
      const edgeOrder  = dfsEdgeOrder(state.nodes);
      const maxLen     = rInd.maxIndelLen;

      const insRates   = track(new M.DoubleVector());
      const delRates   = track(new M.DoubleVector());
      const insDists   = [];
      const delDists   = [];

      for (const nodeId of edgeOrder) {
        const eInd = resolveIndel(nodeId);

        insRates.push_back(eInd.enabled ? eInd.insertionRate : 0);
        delRates.push_back(eInd.enabled ? eInd.deletionRate : 0);

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
      protocol.set_site_rate_model(M.SiteRateModel.INDEL_AWARE);
      protocol.set_insertion_rates(insRates);
      protocol.set_deletion_rates(delRates);
      protocol.set_insertion_length_distributions(insDists, numEdges);
      protocol.set_deletion_length_distributions(delDists, numEdges);

      simCtx.set_protocol(protocol);
      const indelSim   = track(new M.IndelSimulator(simCtx, protocol));
      const eventMap   = track(indelSim.generate_events());
      const catSampler = track(factory.get_rate_category_sampler(protocol.get_max_insertion_length()));
      simCtx.set_category_sampler(catSampler);
      msa = track(M.createMsaFromEvents(eventMap, simCtx));
      sim.set_aligned_sequence_map(msa);
      const rateCats = track(msa.get_per_site_rate_categories());
      sim.set_per_site_rate_categories(rateCats);
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

// ── Run simulation ────────────────────────────────────────────────────────────
export function runSim() {
  if (!state.wasmTree || !state.M) return;
  runBtn.disabled    = true;
  runBtn.textContent = 'Running…';

  const root   = state.nodes.find(n => n.isRoot);
  const rMod   = resolveModelFull(root.id);
  const rInd   = resolveIndel(root.id);
  const nRuns  = Math.max(1, parseInt(document.getElementById('n-runs').value) || 1);
  const toFile = nRuns > 1;

  try {
    let fasta = '', viewText = '', lastResult;

    for (let r = 0; r < nRuns; r++) {
      const result = runOnce(rMod.seed + r, rMod, rInd);
      lastResult   = result;

      for (const row of result.rows) {
        fasta    += `>${row.name}\n${row.seq}\n`;
      }

      fasta += '\n';

      if (!toFile) {
        if (r > 0) viewText += '\n' + '─'.repeat(64) + '\n';
        viewText += `Run ${r + 1} — Model: ${result.modelName}  Indels: ${result.indelOn}  MSA: ${result.msaLen}  Seed: ${rMod.seed + r}\n`;
        viewText += '─'.repeat(64) + '\n';
        for (const row of result.rows)
          viewText += `>${row.name}\n${row.seq}\n`;
      }
    }

    state.lastOutput = fasta;

    if (toFile) {
      downloadFasta(fasta, `sailfish_${nRuns}runs.fasta`);
      showOutput(`${nRuns} runs completed.\nModel: ${rMod.name}  |  Indels: ${rInd.enabled}  |  MSA length: ${lastResult.msaLen}\nSeeds: ${rMod.seed}–${rMod.seed + nRuns - 1}\n\nSaved to sailfish_${nRuns}runs.fasta`);
    } else {
      showOutput(viewText);
    }

  } catch (e) {
    showOutput('Error: ' + e.message);
    console.error(e);
  } finally {
    runBtn.disabled    = false;
    runBtn.textContent = 'Run ▶';
  }
}