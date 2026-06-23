/**
 * web-tree-sitter runtime: init once, cache grammars, parse source.
 *
 * Pinned to web-tree-sitter@0.22 to match the prebuilt grammar ABI in
 * tree-sitter-wasms@0.1.13 (newer cores reject those grammars with a dylink
 * error). TODO(compile): embed the core + grammar wasms for `bun --compile`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Parser from "web-tree-sitter";

const NODE_MODULES = join(import.meta.dir, "..", "..", "node_modules");
const CORE = join(NODE_MODULES, "web-tree-sitter", "tree-sitter.wasm");
const GRAMMAR_DIR = join(NODE_MODULES, "tree-sitter-wasms", "out");

let initialized = false;
const grammars = new Map<string, Parser.Language>();

async function ensureInit(): Promise<void> {
  if (!initialized) {
    await Parser.init({ locateFile: () => CORE });
    initialized = true;
  }
}

/** Whether a prebuilt grammar wasm exists for this name. */
export function grammarExists(name: string): boolean {
  try {
    readFileSync(join(GRAMMAR_DIR, `tree-sitter-${name}.wasm`));
    return true;
  } catch {
    return false;
  }
}

async function loadGrammar(name: string): Promise<Parser.Language> {
  let lang = grammars.get(name);
  if (!lang) {
    const bytes = new Uint8Array(readFileSync(join(GRAMMAR_DIR, `tree-sitter-${name}.wasm`)));
    lang = await Parser.Language.load(bytes);
    grammars.set(name, lang);
  }
  return lang;
}

export interface Parsed {
  root: Parser.SyntaxNode;
  lang: Parser.Language;
}

/** Parse `source` with the named grammar; returns the root node + language. */
export async function parse(grammar: string, source: string): Promise<Parsed> {
  await ensureInit();
  const lang = await loadGrammar(grammar);
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(source);
  return { root: tree.rootNode, lang };
}
