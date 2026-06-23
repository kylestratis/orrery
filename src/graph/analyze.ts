/**
 * Language-agnostic graph analysis over a CodeMap: centrality (PageRank) and
 * import-cycle detection (Tarjan SCC). Entry-point / public-API flags are set by
 * the extractor (they need source-level info); this module only needs the graph.
 */

import type { CodeMap } from "../schema.ts";

type Pair = [string, string];

/** PageRank; edges read source→target ("source depends on target"). */
export function pagerank(nodeIds: string[], edges: Pair[], damping = 0.85, iters = 50): Map<string, number> {
  const nodes = new Set(nodeIds);
  const out = new Map<string, string[]>();
  for (const [s, t] of edges) {
    if (s !== t && nodes.has(s) && nodes.has(t)) {
      const list = out.get(s);
      if (list) list.push(t);
      else out.set(s, [t]);
    }
  }
  const n = nodes.size;
  if (n === 0) return new Map();
  let rank = new Map<string, number>([...nodes].map((v) => [v, 1 / n]));
  for (let i = 0; i < iters; i++) {
    const next = new Map<string, number>([...nodes].map((v) => [v, (1 - damping) / n]));
    let dangling = 0;
    for (const v of nodes) if (!out.has(v)) dangling += rank.get(v)!;
    dangling = (damping * dangling) / n;
    for (const v of nodes) next.set(v, next.get(v)! + dangling);
    for (const [s, targets] of out) {
      const share = (damping * rank.get(s)!) / targets.length;
      for (const t of targets) next.set(t, next.get(t)! + share);
    }
    rank = next;
  }
  return rank;
}

/** Strongly connected components via iterative Tarjan. */
export function sccs(edges: Pair[]): Set<string>[] {
  const adj = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const [s, t] of edges) {
    nodes.add(s);
    nodes.add(t);
    const list = adj.get(s);
    if (list) list.push(t);
    else adj.set(s, [t]);
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: Set<string>[] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: Array<[string, number]> = [[root, 0]];
    while (work.length) {
      const frame = work[work.length - 1]!;
      const [node, pos] = frame;
      if (pos === 0) {
        index.set(node, counter);
        low.set(node, counter);
        counter++;
        stack.push(node);
        onStack.add(node);
      }
      const neighbors = adj.get(node) ?? [];
      let recursed = false;
      for (let i = pos; i < neighbors.length; i++) {
        const w = neighbors[i]!;
        if (!index.has(w)) {
          frame[1] = i + 1;
          work.push([w, 0]);
          recursed = true;
          break;
        } else if (onStack.has(w)) {
          low.set(node, Math.min(low.get(node)!, index.get(w)!));
        }
      }
      if (recursed) continue;
      if (low.get(node) === index.get(node)) {
        const comp = new Set<string>();
        while (true) {
          const w = stack.pop()!;
          onStack.delete(w);
          comp.add(w);
          if (w === node) break;
        }
        result.push(comp);
      }
      work.pop();
      const parent = work[work.length - 1]?.[0];
      if (parent !== undefined) low.set(parent, Math.min(low.get(parent)!, low.get(node)!));
    }
  }
  return result;
}

const GRAPH_KINDS = new Set(["module", "file", "class", "function"]);

/** Annotate nodes in place with `score` (centrality) and `cycle` (SCC membership). */
export function augment(map: CodeMap): void {
  const graphIds = map.nodes.filter((n) => GRAPH_KINDS.has(n.kind)).map((n) => n.id);
  const rank = pagerank(graphIds, map.edges.map((e) => [e.source, e.target] as Pair));
  if (rank.size) {
    const top = Math.max(...rank.values()) || 1;
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    for (const [id, r] of rank) {
      const node = byId.get(id);
      if (node) node.score = Math.round((r / top) * 1e4) / 1e4;
    }
  }
  const importPairs = map.edges.filter((e) => e.kind === "import").map((e) => [e.source, e.target] as Pair);
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  let cycleId = 0;
  for (const comp of sccs(importPairs)) {
    if (comp.size > 1) {
      for (const m of comp) {
        const node = byId.get(m);
        if (node) node.cycle = cycleId;
      }
      cycleId++;
    }
  }
}
