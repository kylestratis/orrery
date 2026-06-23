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
    const ctx = { importerId: file.id, importerPath: file.path, ids, pathToId };
    for (const cap of captures) {
      if (cap.name === "def.class") {
        const cid = `${file.id}:${cap.node.text}`;
        if (!classSeen.has(cid)) {
          classSeen.add(cid);
          nodes.push({ id: cid, kind: "class", parent: file.id, module: file.id, lang: file.lang });
        }
      } else {
        const spec = cap.name === "imp.src" ? stripQuotes(cap.node.text) : cap.node.text;
        const target = plugin.resolveImport(spec, ctx);
        if (target && target !== file.id) {
          const key = `${file.id}|${target}`;
          if (!edgeSeen.has(key)) {
            edgeSeen.add(key);
            edges.push({ source: file.id, target, kind: "import" });
          }
        }
      }
    }
  }

  return { root, nodes, edges };
}
