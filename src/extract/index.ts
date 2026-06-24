/**
 * Extraction: structure (any language) + tree-sitter import/class edges
 * (languages with a plugin). Output is always a CodeMap, so adding languages or
 * the dynamic-augment path never changes the shape.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { CodeEdge, CodeMap, CodeNode } from "../schema.ts";
import { IGNORE_DIRS, langForExt, pluginFor } from "./languages.ts";
import { stripQuotes } from "./plugins.ts";
import { parse } from "./treesitter.ts";
import type Parser from "web-tree-sitter";

interface SourceFile {
  id: string;
  path: string;
  lang: string;
}

function dottedId(root: string, relParts: string[], stripExt = false): string {
  const parts = [...relParts];
  if (stripExt && parts.length) {
    const last = parts[parts.length - 1]!;
    const dot = last.lastIndexOf(".");
    parts[parts.length - 1] = dot > 0 ? last.slice(0, dot) : last;
  }
  return [root, ...parts].join(".");
}

/** Innermost class span containing [start,end], or null. `classSpans` are the
 *  class-definition node ranges paired with their class node id. */
function enclosingClass(
  start: number,
  end: number,
  classSpans: { start: number; end: number; id: string }[],
): string | null {
  let best: string | null = null;
  let bestSpan = Infinity;
  for (const c of classSpans) {
    if (c.start <= start && end <= c.end) {
      const span = c.end - c.start;
      if (span < bestSpan) {
        bestSpan = span;
        best = c.id;
      }
    }
  }
  return best;
}

function walkStructure(repoPath: string, root: string) {
  const nodes: CodeNode[] = [{ id: root, kind: "package", parent: null }];
  const seenPkg = new Set<string>([root]);
  const pathToId = new Map<string, string>();
  const sources: SourceFile[] = [];

  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      const relParts = relative(repoPath, full).split("/");
      if (st.isDirectory()) {
        if (IGNORE_DIRS.has(name)) continue;
        const id = dottedId(root, relParts);
        if (!seenPkg.has(id)) {
          seenPkg.add(id);
          nodes.push({ id, kind: "package", parent: dottedId(root, relParts.slice(0, -1)) });
        }
        walk(full);
      } else {
        const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
        const lang = langForExt(ext);
        if (!lang) continue;
        const id = dottedId(root, relParts, true);
        const path = relParts.join("/");
        nodes.push({ id, kind: "module", parent: dottedId(root, relParts.slice(0, -1)), path, lang });
        pathToId.set(path, id);
        sources.push({ id, path, lang });
      }
    }
  };
  walk(repoPath);
  return { nodes, pathToId, sources };
}

export async function extract(repoPath: string): Promise<CodeMap> {
  const root = basename(repoPath.replace(/\/+$/, "")) || "repo";
  const { nodes, pathToId, sources } = walkStructure(repoPath, root);

  const ids = new Set(nodes.map((n) => n.id));
  const edges: CodeEdge[] = [];
  const edgeSeen = new Set<string>();
  const classSeen = new Set<string>();
  const classIds = new Set<string>(); // all class node ids; consumed by uses extraction (Phase 2)

  for (const file of sources) {
    const plugin = pluginFor(file.lang);
    if (!plugin) continue;
    let source: string;
    try {
      source = readFileSync(join(repoPath, file.path), "utf8");
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = await parse(plugin.grammar, source);
    } catch {
      continue; // unparseable file: keep its structure node, skip edges
    }
    let captures;
    try {
      captures = parsed.lang.query(plugin.query).captures(parsed.root);
    } catch {
      continue;
    }
    const ctx = { importerId: file.id, importerPath: file.path, ids, pathToId, classIds };
    for (const cap of captures) {
      if (cap.name === "def.class") {
        const cid = `${file.id}:${cap.node.text}`;
        if (!classSeen.has(cid)) {
          classSeen.add(cid);
          classIds.add(cid);
          nodes.push({ id: cid, kind: "class", parent: file.id, module: file.id, lang: file.lang });
        }
      } else {
        const spec = cap.name === "imp.src" ? stripQuotes(cap.node.text) : cap.node.text;
        const target = plugin.resolveImport(spec, ctx);
        if (target && target !== file.id) {
          const key = `${file.id}|${target}|import`;
          if (!edgeSeen.has(key)) {
            edgeSeen.add(key);
            edges.push({ source: file.id, target, kind: "import" });
          }
        }
      }
    }
  }

  // --- Pass 2: uses edges (only for files whose plugin defines `uses`) -------
  for (const file of sources) {
    const plugin = pluginFor(file.lang);
    if (!plugin?.uses) continue;
    let source: string;
    try {
      source = readFileSync(join(repoPath, file.path), "utf8");
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = await parse(plugin.grammar, source);
    } catch {
      continue;
    }
    const ctx = { importerId: file.id, importerPath: file.path, ids, pathToId, classIds };

    // 1. Build the per-module symbol table: localName -> intra-repo node id.
    const table = new Map<string, string>();
    // same-module top-level classes (generic: by module ownership)
    for (const n of nodes) {
      if (n.kind === "class" && n.module === file.id) {
        table.set(n.id.slice(file.id.length + 1), n.id);
      }
    }
    // imports (matches() groups each import's captures together)
    let symMatches: Parser.QueryMatch[];
    try {
      symMatches = parsed.lang.query(plugin.uses.symbolQuery).matches(parsed.root);
    } catch {
      symMatches = [];
    }
    for (const m of symMatches) {
      let local = "";
      let spec = "";
      let name: string | null = null;
      for (const c of m.captures) {
        if (c.name === "sym.local") local = c.node.text;
        else if (c.name === "sym.src") spec = c.node.text;
        else if (c.name === "sym.name") name = c.node.text;
      }
      if (!local || !spec) continue;
      const target = plugin.uses.resolveSymbol(stripQuotes(spec), name, ctx);
      if (target) table.set(local, target);
    }

    // 2. Scope references to their enclosing class.
    let refCaps: Parser.QueryCapture[];
    try {
      refCaps = parsed.lang.query(plugin.uses.referenceQuery).captures(parsed.root);
    } catch {
      refCaps = [];
    }
    const classSpans: { start: number; end: number; id: string }[] = [];
    const skip = new Set<string>();
    for (const cap of refCaps) {
      if (cap.name === "def.class") {
        const def = cap.node.parent ?? cap.node; // class-definition node spans the body
        classSpans.push({ start: def.startIndex, end: def.endIndex, id: `${file.id}:${cap.node.text}` });
      } else if (cap.name === "skip") {
        skip.add(`${cap.node.startIndex}:${cap.node.endIndex}`);
      }
    }

    // 3. Resolve, filter, emit.
    for (const cap of refCaps) {
      if (cap.name !== "ref") continue;
      if (skip.has(`${cap.node.startIndex}:${cap.node.endIndex}`)) continue;
      const owner = enclosingClass(cap.node.startIndex, cap.node.endIndex, classSpans);
      if (!owner) continue;
      const target = table.get(cap.node.text);
      if (!target) continue; // unresolved (AC3.3)
      if (target === owner) continue; // self (AC3.1)
      if (target === file.id) continue; // own-module-only (AC3.2)
      const key = `${owner}|${target}|uses`;
      if (!edgeSeen.has(key)) {
        edgeSeen.add(key); // dedup within a class (AC2.5)
        edges.push({ source: owner, target, kind: "uses" });
      }
    }
  }

  return { root, nodes, edges };
}
