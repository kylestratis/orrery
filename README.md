# orrery

> Build and fly through an interactive 3D map of any codebase.

`orrery` turns a repository into a self-contained, offline HTML file: a 3D,
navigable map of its structure and dependencies, with the README alongside.
Fly with WASD, orbit/zoom with the mouse, click a node to focus it (the rest
dims), and read off the signals that matter for understanding unfamiliar code —
**centrality** (core abstractions grow larger), **import cycles**, and
**entry points / public API**.

It's a deterministic CLI. An optional agent skill (planned) sits on top only for
the non-deterministic glue: detecting the language/root and, when a repo has
dynamic wiring (registries, plugin loaders, DI), generating analysis on the fly
that it feeds back in via `--augment`.

## Install / run

Requires [Bun](https://bun.sh) ≥ 1.3.

```sh
bun install
bun run orrery build /path/to/repo      # → /path/to/repo/orrery.html
bun run orrery build . --out map.html --open
```

A single-binary build (`bun build --compile`) is on the roadmap:
`orrery build <repo>` with no runtime required.

## How it works

```
extract  →  analyze  →  render
(per-lang)  (graph)      (1 HTML)
```

1. **extract** — walk the repo, build the node/edge graph. v0 emits the
   folder/file structure for any language; the tree-sitter layer (next) adds
   `import` and class-level `uses` edges per language.
2. **analyze** — language-agnostic graph overlays: PageRank centrality and
   Tarjan strongly-connected-components (import cycles).
3. **render** — inline the graph + README + vendored `3d-force-graph` into one
   offline HTML.

### The contract

Everything flows through one type, [`CodeMap`](src/schema.ts) — `{ root, nodes,
edges }`. It's the only interface between extraction and rendering, and the plug
point for external/agent-generated data via `mergeCodeMaps` / `--augment`.

## Status

- ✅ CLI pipeline, structure extraction (any language), centrality + cycle
  analysis, self-contained 3D renderer, `--augment` merge.
- ⏳ Tree-sitter `import` / `uses` edges (per-language plugins).
- ⏳ `bun build --compile` single binary (embed template + vendor assets).
- ⏳ Entry-point / public-API detection per language.
- ⏳ Agent skill wrapper (language/root detection, dynamic-analysis augmentation).

## Layout

```
src/
  cli.ts            # `orrery build <repo>`
  schema.ts         # the CodeMap contract
  extract/          # structure walk + (next) tree-sitter language plugins
  graph/analyze.ts  # PageRank + SCC cycle detection
  render/           # template.html + inliner
vendor/             # pinned 3d-force-graph + marked
```
