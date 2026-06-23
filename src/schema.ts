/**
 * The orrery data contract.
 *
 * `CodeMap` is the single interface between extraction (language-specific,
 * tree-sitter based) and rendering (language-agnostic). Anything that can emit
 * a valid `CodeMap` — including an agent writing dynamic-analysis edges on the
 * fly — can drive the visualizer. Keep this stable; everything depends on it.
 */

export type NodeKind = "package" | "module" | "file" | "class" | "function";

export interface CodeNode {
  /** Stable unique id. Convention: dotted path; classes/functions use "module:Qualname". */
  id: string;
  kind: NodeKind;
  /** id of the containing node (folder tree), or null/undefined at the root. */
  parent?: string | null;
  /** repo-relative source path (modules/files). */
  path?: string;
  /** owning module id (classes/functions). */
  module?: string;
  /** source language tag, e.g. "python", "typescript". */
  lang?: string;

  // --- analysis overlays (added by graph/analyze) ---
  /** centrality 0..1 (PageRank); core abstractions trend toward 1. */
  score?: number;
  /** strongly-connected-component id if the node sits in an import cycle. */
  cycle?: number;
  /** entry point flavor, if any. */
  entry?: "main" | "script";
  /** part of the declared public API (e.g. re-exported / __all__). */
  public?: boolean;

  [key: string]: unknown;
}

export type EdgeKind = "import" | "uses" | "registers" | "calls";

export interface CodeEdge {
  source: string;
  target: string;
  kind: EdgeKind;
}

export interface CodeMap {
  /** root package / repo name. */
  root: string;
  nodes: CodeNode[];
  edges: CodeEdge[];
}

/** Merge extra nodes/edges (e.g. agent-generated dynamic analysis) into a map. */
export function mergeCodeMaps(base: CodeMap, extra: Partial<CodeMap>): CodeMap {
  const byId = new Map(base.nodes.map((n) => [n.id, n]));
  for (const n of extra.nodes ?? []) {
    const existing = byId.get(n.id);
    if (existing) Object.assign(existing, n);
    else {
      byId.set(n.id, n);
      base.nodes.push(n);
    }
  }
  const seen = new Set(base.edges.map((e) => `${e.source}|${e.target}|${e.kind}`));
  for (const e of extra.edges ?? []) {
    const key = `${e.source}|${e.target}|${e.kind}`;
    if (!seen.has(key)) {
      seen.add(key);
      base.edges.push(e);
    }
  }
  return base;
}
