import { state, AMINO_MODELS } from './state.js';
import { resolveModelFull, resolveIndel } from './tree.js';

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
  const ci  = row.indexOf(':');
  const ti  = row.indexOf('\t');
  const si  = row.indexOf(' ');
  if (ci > 0) return { name: row.slice(0, ci).trim(), seq: row.slice(ci + 1).trim() };
  if (ti > 0) return { name: row.slice(0, ti),        seq: row.slice(ti + 1) };
  if (si > 0) return { name: row.slice(0, si),        seq: row.slice(si + 1) };
  return { name: null, seq: row };
}

// ── Single run ────────────────────────────────────────────────────────────────
export function runOnce(seed, rMod, rInd) {
  const { M, wasmTree } = state;
  const modelName = rMod.name;
  const seqLen    = rMod.seqLen;
  const isAmino   = AMINO_MODELS.has(modelName);
  const indelOn   = rInd.enabled;

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
      const numEdges  = wasmTree.num_nodes - 1;
      const distProbs = track(new M.DoubleVector());
      for (let i = 0; i < 20; i++) distProbs.push_back(Math.pow(0.5, i + 1));
      const dist     = track(new M.DiscreteDistribution(distProbs));
      const protocol = track(new M.SimProtocol(numEdges));
      protocol.set_sequence_size(seqLen);
      protocol.set_minimum_sequence_size(Math.max(1, Math.floor(seqLen / 10)));
      protocol.set_max_insertion_length(20);
      protocol.set_site_rate_model(M.SiteRateModel.INDEL_AWARE);
      const insRates = track(new M.DoubleVector());
      const delRates = track(new M.DoubleVector());
      for (let i = 0; i < numEdges; i++) {
        insRates.push_back(rInd.insertionRate);
        delRates.push_back(rInd.deletionRate);
      }
      protocol.set_insertion_rates(insRates);
      protocol.set_deletion_rates(delRates);
      protocol.set_insertion_length_distribution_uniform(dist, numEdges);
      protocol.set_deletion_length_distribution_uniform(dist, numEdges);
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
    const container = track(sim.simulate_substitutions(msaLen));
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
        fasta += `${row.seq}\n`;
      }
      fasta += '\n';

      if (!toFile) {
        if (r > 0) viewText += '\n' + '─'.repeat(64) + '\n';
        viewText += `Run ${r + 1} — Model: ${result.modelName}  Indels: ${result.indelOn}  MSA: ${result.msaLen}  Seed: ${rMod.seed + r}\n`;
        viewText += '─'.repeat(64) + '\n';
        for (const row of result.rows)
          viewText += (row.name ? `${row.name}: ${row.seq}` : row.seq) + '\n';
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
