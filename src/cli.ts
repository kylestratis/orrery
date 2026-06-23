#!/usr/bin/env bun
/**
 * orrery — build and fly through an interactive 3D map of any codebase.
 *
 * Usage:
 *   orrery build <repo> [--out <file.html>] [--augment <edges.json> ...] [--open]
 *   orrery --help | --version
 *
 * `build` is fully deterministic: extract (tree-sitter / structure) → analyze
 * (centrality, cycles) → render one self-contained HTML. `--augment` merges
 * external CodeMap fragments (e.g. agent-generated dynamic-analysis edges).
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { extract } from "./extract/index.ts";
import { augment } from "./graph/analyze.ts";
import { render } from "./render/index.ts";
import { mergeCodeMaps, type CodeMap } from "./schema.ts";

const VERSION = "0.0.1";

const HELP = `orrery ${VERSION} — build & fly through a 3D map of any codebase

Usage:
  orrery build <repo> [options]

Options:
  --out <file>        output HTML path (default: <repo>/orrery.html)
  --augment <file>    merge a CodeMap JSON fragment (repeatable)
  --open              open the result in the default browser
  -h, --help          show this help
  -v, --version       show version
`;

function parseArgs(argv: string[]) {
  const opts = { out: "", augment: [] as string[], open: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--out") opts.out = argv[++i] ?? "";
    else if (a === "--augment") opts.augment.push(argv[++i] ?? "");
    else if (a === "--open") opts.open = true;
    else positional.push(a);
  }
  return { opts, positional };
}

function build(argv: string[]): number {
  const { opts, positional } = parseArgs(argv);
  const repoArg = positional[0];
  if (!repoArg) {
    console.error("error: missing <repo> path\n\n" + HELP);
    return 1;
  }
  const repo = resolve(repoArg);
  if (!existsSync(repo)) {
    console.error(`error: path does not exist: ${repo}`);
    return 1;
  }

  const map: CodeMap = extract(repo);
  for (const file of opts.augment) {
    if (!existsSync(file)) {
      console.error(`error: --augment file not found: ${file}`);
      return 1;
    }
    mergeCodeMaps(map, JSON.parse(readFileSync(file, "utf8")) as Partial<CodeMap>);
  }
  augment(map);

  const readmePath = join(repo, "README.md");
  const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
  const out = opts.out || join(repo, "orrery.html");
  render(map, { readme, out });

  const mods = map.nodes.filter((n) => n.kind === "module").length;
  const pkgs = map.nodes.filter((n) => n.kind === "package").length;
  console.log(`orrery: ${pkgs} packages, ${mods} modules, ${map.edges.length} edges → ${out}`);

  if (opts.open) Bun.spawn(["open", out]);
  return 0;
}

function main(): number {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(HELP);
    return 0;
  }
  if (cmd === "-v" || cmd === "--version") {
    console.log(VERSION);
    return 0;
  }
  if (cmd === "build") return build(argv.slice(1));
  console.error(`error: unknown command '${cmd}'\n\n` + HELP);
  return 1;
}

process.exit(main());
