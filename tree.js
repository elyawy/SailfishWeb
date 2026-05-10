import { state, DEF_MODEL, DEF_INDEL, LEAF_GAP, PAD_LEFT, PAD_RIGHT, PAD_TOP } from './state.js';

// ── Build layout from WASM tree ───────────────────────────────────────────────
export function buildLayout(wt) {
  const result = [];
  let leafIdx  = 0;

  function walk(wnode, parentId, cumX) {
    const id        = result.length;
    const name      = wnode.name || '';
    const branchLen = parentId === null ? 0 : wnode.distance_to_father();
    const node = { id, name, parentId, isRoot: parentId === null,
                   x: cumX, y: 0, wx: 0, wy: 0,
                   branchLen, isLeaf: false, children: [] };
    result.push(node);
    if (parentId !== null) result[parentId].children.push(id);

    const childList = [];
    for (const s of wnode.sons) childList.push(s);

    if (childList.length === 0) {
      node.isLeaf = true;
      node.y = leafIdx++;
    } else {
      for (const child of childList)
        walk(child, id, cumX + child.distance_to_father());
      const ys = node.children.map(c => result[c].y);
      node.y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
  }

  walk(wt.root, null, 0);
  return result;
}

// ── Resolve params up the tree ────────────────────────────────────────────────
export function resolveModel(nodeId) {
  let cur = nodeId;
  while (cur !== null) {
    const o = state.overrides.get(cur);
    if (o?.model) return o.model.name;
    cur = state.nodes[cur]?.parentId ?? null;
  }
  return DEF_MODEL.name;
}

export function resolveModelFull(nodeId) {
  let cur = nodeId;
  while (cur !== null) {
    const o = state.overrides.get(cur);
    if (o?.model) return { ...o.model };
    cur = state.nodes[cur]?.parentId ?? null;
  }
  return { ...DEF_MODEL };
}

export function resolveIndel(nodeId) {
  let cur = nodeId;
  while (cur !== null) {
    const o = state.overrides.get(cur);
    if (o?.indel) return { ...o.indel };
    cur = state.nodes[cur]?.parentId ?? null;
  }
  return { ...DEF_INDEL };
}

export function resolveSource(nodeId, key) {
  let cur = state.nodes[nodeId]?.parentId ?? null;
  while (cur !== null) {
    if (state.overrides.get(cur)?.[key]) return cur;
    cur = state.nodes[cur]?.parentId ?? null;
  }
  return null;
}

// ── Override helpers ──────────────────────────────────────────────────────────
export function ensureOverride(nodeId, key) {
  if (!state.overrides.has(nodeId)) state.overrides.set(nodeId, {});
  const o = state.overrides.get(nodeId);
  if (!o[key]) {
    o[key] = key === 'model' ? resolveModelFull(nodeId) : resolveIndel(nodeId);
  }
}

export function dropOverrideKey(nodeId, key) {
  const o = state.overrides.get(nodeId);
  if (!o) return;
  delete o[key];
  if (!o.model && !o.indel) state.overrides.delete(nodeId);
}

export function resetSubtree(nodeId) {
  function clear(id) {
    if (id !== nodeId) state.overrides.delete(id);
    for (const c of state.nodes[id].children) clear(c);
  }
  clear(nodeId);
}

// ── Tree helpers ──────────────────────────────────────────────────────────────
export function getLeafNames(nodeId) {
  const acc = [];
  function collect(id) {
    const n = state.nodes[id];
    if (n.isLeaf) { acc.push(n.name); return; }
    for (const c of n.children) collect(c);
  }
  collect(nodeId);
  return acc;
}

export function getDepth(nodeId) {
  let d = 0, cur = state.nodes[nodeId].parentId;
  while (cur !== null) { d++; cur = state.nodes[cur].parentId; }
  return d;
}

export function nodeName(id) {
  const n = state.nodes[id];
  return n.name || (n.isRoot ? 'root' : `node ${id}`);
}
