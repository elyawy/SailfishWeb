// ── Model lists ───────────────────────────────────────────────────────────────
export const AMINO_MODELS = new Set(['LG','WAG','DAYHOFF','JONES','CPREV45','HIVB','HIVW','MTREV24','AAJC']);
export const ALL_MODELS   = ['LG','WAG','DAYHOFF','JONES','CPREV45','HIVB','HIVW','MTREV24',
                              'HKY','GTR','NUCJC','TAMURA92'];

// ── Defaults ──────────────────────────────────────────────────────────────────
export const DEF_MODEL = { name: 'LG', seqLen: 100, seed: 42 };
export const DEF_INDEL = { enabled: false, insertionRate: 0.05, deletionRate: 0.05 };

// ── Layout constants ──────────────────────────────────────────────────────────
export const LEAF_GAP  = 20;
export const PAD_LEFT  = 50;
export const PAD_RIGHT = 150;
export const PAD_TOP   = 20;
export const NODE_R    = 4;
export const HIT_R     = 10;

// ── Mutable shared state ──────────────────────────────────────────────────────
export const state = {
  M:          null,
  wasmTree:   null,
  nodes:      [],          // [{id, name, x, y, wx, wy, parentId, isLeaf, isRoot, branchLen, children}]
  overrides:  new Map(),   // nodeId → {model?, indel?}
  selectedId: null,
  lastOutput: '',
  rootSeq:    '',
  pan:        { x: 0, y: 0 },
  zoom:       1,
  drag:       null,        // null | { sx, sy, px, py, moved }
};