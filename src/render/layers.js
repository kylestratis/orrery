/**
 * Containment-zoom engine: pure transform from the full CodeMap plus the
 * current expansion state to the subset of nodes/links to render.
 *
 * No DOM, no globals, no library dependencies — unit-testable under bun and
 * inlinable into the self-contained HTML as a classic <script> (UMD-style
 * tail below; no ESM syntax in this file).
 */

/**
 * Resolve a node id to the id of its nearest ancestor on the visible
 * frontier. Non-class nodes (packages, modules) are always visible and
 * resolve to themselves; a class resolves to itself when its module is
 * expanded, otherwise to its module. Returns null when the id is unknown
 * or a collapsed class's module is missing from the map (callers drop
 * such edges rather than render a dangling link).
 *
 * @param {string} nodeId - Id to resolve.
 * @param {Map<string, object>} nodesById - All CodeMap nodes keyed by id.
 * @param {Set<string>} expanded - Module ids whose classes are visible.
 * @returns {string | null} Visible ancestor id, or null.
 */
function nearestVisibleAncestor(nodeId, nodesById, expanded) {
  const node = nodesById.get(nodeId);
  if (!node) return null;
  if (node.kind !== 'class') return nodeId;
  if (expanded.has(node.module)) return nodeId;
  return nodesById.has(node.module) ? node.module : null;
}

/**
 * Build the displayable graph for the current expansion state: the visible
 * frontier (packages + modules always; classes of expanded modules), a
 * synthesized `contains` link (module→class) anchoring each visible class,
 * and every real edge with endpoints lifted to their nearest visible
 * ancestor. Self-loops produced by lifting are dropped; parallel links are
 * deduped by `source|target|kind` with `lifted` OR-merged across the raw
 * edges that share a key. Links keep CodeMap direction (source → target);
 * the rendering shell owns any arrow-direction conventions.
 *
 * @param {object[]} nodes - Full CodeMap node set.
 * @param {object[]} edges - Full CodeMap edge set.
 * @param {Set<string>} expanded - Module ids whose classes are visible.
 * @returns {{ nodes: object[], links: object[] }} References into `nodes`,
 *   plus links of shape { source, target, kind, lifted }.
 */
function buildDisplayGraph(nodes, edges, expanded) {
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const visible = nodes.filter(
    (n) => n.kind !== 'class' || expanded.has(n.module),
  );

  const links = [];
  for (const n of visible) {
    if (n.kind === 'class') {
      links.push({ source: n.module, target: n.id, kind: 'contains', lifted: false });
    }
  }

  const byKey = new Map();
  for (const e of edges) {
    const source = nearestVisibleAncestor(e.source, nodesById, expanded);
    const target = nearestVisibleAncestor(e.target, nodesById, expanded);
    if (!source || !target || source === target) continue;
    const lifted = source !== e.source || target !== e.target;
    const key = `${source}|${target}|${e.kind}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.lifted = prev.lifted || lifted;
      continue;
    }
    const link = { source, target, kind: e.kind, lifted };
    byKey.set(key, link);
    links.push(link);
  }

  return { nodes: visible, links };
}

// UMD-lite: CommonJS export for bun tests; globals for the inlined <script>.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildDisplayGraph, nearestVisibleAncestor };
} else {
  globalThis.buildDisplayGraph = buildDisplayGraph;
  globalThis.nearestVisibleAncestor = nearestVisibleAncestor;
}
