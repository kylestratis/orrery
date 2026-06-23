/**
 * Language registry: file-extension → language tag, dirs to skip, and the
 * tree-sitter plugin (if any) for a tag. Languages without a plugin still get
 * structure nodes (folders/files) — they just lack import/class edges for now.
 */

import { PLUGINS, type Plugin } from "./plugins.ts";

/** file extension (no dot) -> language tag (also the plugin key). */
export const EXT_LANG: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript",
  tsx: "tsx",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", pyi: "python",
  // structure-only for now (no plugin yet):
  rs: "rust", go: "go", java: "java", kt: "kotlin", kts: "kotlin",
  rb: "ruby", php: "php", cs: "csharp", swift: "swift", scala: "scala",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  lua: "lua", ex: "elixir", exs: "elixir",
};

export function langForExt(ext: string): string | undefined {
  return EXT_LANG[ext.toLowerCase()];
}

export function pluginFor(lang: string): Plugin | undefined {
  return PLUGINS[lang];
}

/** Directory names never worth descending into. */
export const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target",
  ".venv", "venv", "__pycache__", ".next", ".nuxt", ".cache", "vendor",
  ".bun", ".idea", ".vscode", "coverage", "htmlcov", ".mypy_cache", ".pytest_cache",
  ".ruff_cache", "site", ".deciduous", ".beads",
]);
