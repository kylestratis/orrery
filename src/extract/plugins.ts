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
  /** All intra-repo class node ids (e.g. "repo.pkg.base:Base"); lets a
   *  resolver prefer a class over its module. Populated in extract() pass 1. */
  classIds: Set<string>;
}

/**
 * Optional per-language `uses`-edge extraction. The orchestrator owns all the
 * generic logic; a plugin only supplies two tree-sitter queries plus a thin
 * resolver. Capture-name vocabulary (the orchestrator bins captures by name):
 *
 *   symbolQuery captures (grouped per import via Query.matches):
 *     @sym.local  the bound local name (alias if aliased)
 *     @sym.src    the module / dotted-path / string specifier
 *     @sym.name   the imported leaf name, for `from`-style imports (optional)
 *
 *   referenceQuery captures (flat, via Query.captures):
 *     @def.class  a class name node — its .parent spans the class body, used to
 *                 scope references to their enclosing class
 *     @ref        a candidate referenced identifier (attribute-chain root,
 *                 heritage/base type, or a load identifier)
 *     @skip       identifier positions to subtract from @ref by source position
 *                 (e.g. an attribute's property name in `a.b.c`)
 */
export interface UsesCapability {
  symbolQuery: string;
  referenceQuery: string;
  /** Map an import binding to an intra-repo node id, class-preferred with module
   *  fallback. `name` is the imported leaf for `from`-style imports (else null). */
  resolveSymbol(spec: string, name: string | null, ctx: ResolveCtx): string | null;
}

export interface Plugin {
  grammar: string;
  query: string;
  resolveImport(spec: string, ctx: ResolveCtx): string | null;
  /** Optional `uses`-edge extraction. Absent = language emits no uses edges. */
  uses?: UsesCapability;
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

/** Resolve an imported binding to a node id: prefer the class, then a submodule,
 *  then the module. Mirrors the prototype's class → submodule → module order. */
function pyResolveSymbol(spec: string, name: string | null, ctx: ResolveCtx): string | null {
  const mod = pyResolve(spec, ctx); // module/package id, or null for external
  if (name) {
    if (mod) {
      const classId = `${mod}:${name}`;
      if (ctx.classIds.has(classId)) return classId; // from MOD import Class
    }
    // from . import submodule  /  from pkg import submodule
    const joined = spec.endsWith(".") ? `${spec}${name}` : `${spec}.${name}`;
    const sub = pyResolve(joined, ctx);
    if (sub) return sub;
  }
  return mod; // module fallback (or null)
}

const PY_SYMBOL_QUERY = `
  ; import a.b.c            -> local = first segment, src = full dotted path
  (import_statement (dotted_name . (identifier) @sym.local) @sym.src)
  ; import a.b.c as x       -> local = alias
  (import_statement (aliased_import name: (dotted_name) @sym.src alias: (identifier) @sym.local))
  ; from .mod import Name [as Local]
  (import_from_statement
    module_name: (_) @sym.src
    name: (dotted_name (identifier) @sym.name @sym.local))
  (import_from_statement
    module_name: (_) @sym.src
    name: (aliased_import name: (dotted_name (identifier) @sym.name) alias: (identifier) @sym.local))
`;

const PY_REFERENCE_QUERY = `
  ; class names (for enclosing-class scoping)
  (class_definition name: (identifier) @def.class)
  ; attribute property names are NOT references (the chain root is) -> skip them
  (attribute attribute: (identifier) @skip)
  ; every load identifier is a candidate; the symbol table is the real filter
  (identifier) @ref
`;

const python: Plugin = {
  grammar: "python",
  query: `
    (import_statement (dotted_name) @imp.abs)
    (import_statement (aliased_import (dotted_name) @imp.abs))
    (import_from_statement module_name: (_) @imp.from)
    (class_definition name: (identifier) @def.class)
  `,
  resolveImport: pyResolve,
  uses: {
    symbolQuery: PY_SYMBOL_QUERY,
    referenceQuery: PY_REFERENCE_QUERY,
    resolveSymbol: pyResolveSymbol,
  },
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
