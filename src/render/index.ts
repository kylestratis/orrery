/**
 * Render a CodeMap into one self-contained, offline HTML file.
 *
 * v0 reads the template + vendored JS from disk (relative to this module) so it
 * works under `bun run`. TODO(compile): switch to Bun's embedded-file mechanism
 * so `bun build --compile` produces a fully self-contained binary.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CodeMap } from "../schema.ts";

const HERE = import.meta.dir; // src/render
const VENDOR = join(HERE, "..", "..", "vendor");
const TEMPLATE = join(HERE, "template.html");
const VENDOR_FILES = ["3d-force-graph.min.js", "marked.min.js"];

/** Escape an embedded JSON/JS string so it cannot terminate the <script>. */
function jsSafe(text: string): string {
  return text.replaceAll("</", "<\\/");
}

export interface RenderOptions {
  readme?: string;
  out: string;
}

export function render(map: CodeMap, opts: RenderOptions): string {
  const template = readFileSync(TEMPLATE, "utf8");
  const vendor = VENDOR_FILES
    .map((f) => `<script>\n${readFileSync(join(VENDOR, f), "utf8")}\n</script>`)
    .join("\n");

  // Use function replacements: a plain-string replacement would interpret `$&`,
  // `$1`, etc. inside JSON/README content (e.g. shell `$` snippets) and corrupt it.
  const html = template
    .replace("<!--{{VENDOR}}-->", () => vendor)
    .replace("/*{{DATA}}*/ null", () => "/*{{DATA}}*/ " + jsSafe(JSON.stringify(map)))
    .replace('/*{{README}}*/ ""', () => '/*{{README}}*/ ' + jsSafe(JSON.stringify(opts.readme ?? "")));

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, html, "utf8");
  return opts.out;
}
