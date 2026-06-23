/**
 * Extraction. v0 produces the folder/file structure (package + module nodes with
 * parent links) for ANY repo — already renderable as a 3D tree. Dependency edges
 * (import / uses) come from the tree-sitter layer next; the function signature
 * and CodeMap output stay the same, so that's an additive change.
 */

import { readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { CodeMap, CodeNode } from "../schema.ts";
import { IGNORE_DIRS, langForExt } from "./languages.ts";

/** Dotted id from a repo-relative path, rooted at the repo name. */
function dottedId(root: string, relParts: string[], stripExt = false): string {
  const parts = [...relParts];
  if (stripExt && parts.length) {
    const last = parts[parts.length - 1]!;
    const dot = last.lastIndexOf(".");
    parts[parts.length - 1] = dot > 0 ? last.slice(0, dot) : last;
  }
  return [root, ...parts].join(".");
}

export function extract(repoPath: string): CodeMap {
  const root = basename(repoPath.replace(/\/+$/, "")) || "repo";
  const nodes: CodeNode[] = [{ id: root, kind: "package", parent: null }];
  const seenPkg = new Set<string>([root]);

  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".") && name !== ".") continue;
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
        const parent = dottedId(root, relParts.slice(0, -1));
        if (!seenPkg.has(id)) {
          seenPkg.add(id);
          nodes.push({ id, kind: "package", parent });
        }
        walk(full);
      } else {
        const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
        const lang = langForExt(ext);
        if (!lang) continue; // only source files become nodes
        nodes.push({
          id: dottedId(root, relParts, true),
          kind: "module",
          parent: dottedId(root, relParts.slice(0, -1)),
          path: relParts.join("/"),
          lang,
        });
      }
    }
  };
  walk(repoPath);

  return { root, nodes, edges: [] };
}
