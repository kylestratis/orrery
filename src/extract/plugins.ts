/**
 * Per-language extraction plugins. Each plugin = a tree-sitter grammar + a query
 * capturing imports and class definitions + a resolver mapping an import
 * specifier to an intra-repo node id. Adding a language never touches the core.
 *
 * Capture names the orchestrator understands:
 *   @imp.abs  python absolute dotted import      (import a.b.c)
 *   @imp.from python from-import module path     (from .x import y / from a.b import y)
 *   @imp.src  js/ts module string literal        (import ... from "./x")
 *   @def.class  class definition name
 */

import { posix } from "node:path";

export interface ResolveCtx {
  importerId: string;
  importerPath: string;
  ids: Set<string>;
  pathToId: Map<string, string>;
}

export interface Plugin {
  grammar: string;
  query: string;
  resolveImport(spec: string, ctx: ResolveCtx): string | null;
}

// --- Python ---------------------------------------------------------------

function pyResolve(spec: string, ctx: ResolveCtx): string | null {
  if (spec.startsWith(".")) {
    let level = 0;
    while (level < spec.length && spec[level] === ".") level++;
    const rest = spec.slice(level);
    const parts = ctx.importerId.split("."); // module id
    parts.pop(); // -> its package
    for (let k = 0; k < level - 1; k++) parts.pop(); // climb extra dots
    const cand = (rest ? [...parts, ...rest.split(".")] : parts).join(".");
    return ctx.ids.has(cand) ? cand : null;
  }
  // absolute: longest dotted prefix that is a known module/package
  const segs = spec.split(".");
  for (let n = segs.length; n > 0; n--) {
    const p = segs.slice(0, n).join(".");
    if (ctx.ids.has(p)) return p;
  }
  return null;
}

const python: Plugin = {
  grammar: "python",
  query: `
    (import_statement (dotted_name) @imp.abs)
    (import_statement (aliased_import (dotted_name) @imp.abs))
    (import_from_statement module_name: (_) @imp.from)
    (class_definition name: (identifier) @def.class)
  `,
  resolveImport: pyResolve,
};

// --- TypeScript / JavaScript ----------------------------------------------

const JS_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];
const JS_INDEX = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

function jsResolve(spec: string, ctx: ResolveCtx): string | null {
  if (!spec.startsWith(".")) return null; // bare specifier = external dependency
  const base = posix.normalize(posix.join(posix.dirname(ctx.importerPath), spec));
  for (const e of JS_EXTS) {
    const id = ctx.pathToId.get(base + e);
    if (id) return id;
  }
  for (const e of JS_INDEX) {
    const id = ctx.pathToId.get(base + e);
    if (id) return id;
  }
  return null;
}

const TS_QUERY = `
  (import_statement source: (string) @imp.src)
  (export_statement source: (string) @imp.src)
  (class_declaration name: (type_identifier) @def.class)
  (abstract_class_declaration name: (type_identifier) @def.class)
`;

const typescript: Plugin = { grammar: "typescript", query: TS_QUERY, resolveImport: jsResolve };
const tsx: Plugin = { grammar: "tsx", query: TS_QUERY, resolveImport: jsResolve };

const javascript: Plugin = {
  grammar: "javascript",
  query: `
    (import_statement source: (string) @imp.src)
    (export_statement source: (string) @imp.src)
    (class_declaration name: (identifier) @def.class)
  `,
  resolveImport: jsResolve,
};

/** lang tag (see EXT_LANG) -> plugin. */
export const PLUGINS: Record<string, Plugin> = { python, typescript, tsx, javascript };

/** Strip surrounding quotes/backticks from a JS string-literal node's text. */
export function stripQuotes(text: string): string {
  return text.length >= 2 && /^["'`]/.test(text) ? text.slice(1, -1) : text;
}
