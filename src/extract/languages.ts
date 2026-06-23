/**
 * Language registry. v0 uses this only to decide which files are "source" (and
 * to tag a node's language). The tree-sitter `LanguagePlugin` interface below is
 * the boundary for the next layer (per-language import/symbol queries).
 */

/** file extension (no dot) -> language tag */
export const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", pyi: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin", kts: "kotlin",
  rb: "ruby",
  php: "php",
  cs: "csharp",
  swift: "swift",
  scala: "scala",
  c: "c", h: "c",
  cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  m: "objc", mm: "objc",
  lua: "lua",
  ex: "elixir", exs: "elixir",
};

export function langForExt(ext: string): string | undefined {
  return EXT_LANG[ext.toLowerCase()];
}

/** Directory names never worth descending into. */
export const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target",
  ".venv", "venv", "__pycache__", ".next", ".nuxt", ".cache", "vendor",
  ".bun", ".idea", ".vscode", "coverage", "htmlcov", ".mypy_cache", ".pytest_cache",
  ".ruff_cache", "site", ".deciduous", ".beads",
]);

/**
 * Tree-sitter extraction boundary (next layer). Each plugin maps a language to
 * its grammar + queries that yield definition nodes and import/uses edges. Kept
 * here as the contract so adding a language never touches the core.
 */
export interface LanguagePlugin {
  lang: string;
  /** path/specifier of the tree-sitter wasm grammar. */
  grammarWasm: string;
  /** tree-sitter query (S-expression) capturing @import / @class / @function / @ref. */
  query: string;
}

/** Registered tree-sitter plugins (empty in v0; populated in the extraction layer). */
export const PLUGINS = new Map<string, LanguagePlugin>();
