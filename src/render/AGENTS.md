# Render Domain

Last verified: 2026-07-15

## Purpose
Turns a `CodeMap` into a single self-contained, offline HTML file that visualizes
the codebase as a 3D force graph with containment zoom (files collapse/expand to
reveal their classes).

## Contracts
- **Exposes**: `render(map, { readme?, out }) → outPath` (`index.ts`); the pure
  engine `buildDisplayGraph(nodes, edges, expanded)` and
  `nearestVisibleAncestor(nodeId, nodesById, expanded)` (`layers.js`), typed in
  `layers.d.ts` (`Node`, `Edge`, `Link`).
- **Guarantees**:
  - `render` resolves every template marker; no `<!--{{…}}-->` or `/*{{…}}*/`
    placeholder survives in the output (asserted by `tests/render.test.ts`).
  - `buildDisplayGraph` returns the visible frontier (packages + modules always;
    classes only for expanded modules), synthesized `contains` links
    (module→class) for each visible class, and every real edge lifted to nearest
    visible ancestors. Self-loops from lifting are dropped; parallel links are
    deduped by `source|target|kind` with `lifted` OR-merged. Links keep CodeMap
    direction (`source → target`).
  - Returned nodes are references into the input `nodes` array (no copies).
- **Expects**: a valid `CodeMap` (see `../schema.ts`); class nodes carry a
  `module` field. `vendor/` holds the vendored JS listed in `VENDOR_FILES`.

## Dependencies
- **Uses**: `../schema.ts` (`CodeMap` type only); `node:fs`/`node:path`;
  vendored browser libs in `vendor/` (`3d-force-graph.min.js`, `marked.min.js`).
- **Used by**: the CLI/pipeline that emits the HTML artifact.
- **Boundary**: `layers.js` must stay DOM-free, global-free, and dependency-free
  so it is unit-testable under bun AND inlinable as a classic `<script>`. Do NOT
  add ESM `import`/`export` to `layers.js` — it uses a UMD-lite tail
  (CommonJS for tests, `globalThis` for the inlined shell).

## Key Decisions
- Marker injection: `render` string-replaces `<!--{{VENDOR}}-->`,
  `<!--{{LAYERS}}-->`, `/*{{DATA}}*/ null`, `/*{{README}}*/ ""`. Replacements use
  function form so `$&`/`$1` in JSON/README content is not interpreted.
- Engine is direction-neutral; the shell (`template.html`) owns arrow-direction
  conventions — it renders real edges provider→consumer (arrow points at the
  dependent) and draws `contains` links with no arrow.
- v0 reads `template.html` + `layers.js` from disk relative to the module so it
  runs under `bun run`; `bun build --compile` embedding is a TODO in `index.ts`.

## Invariants
- Every template marker resolves at render time (no leftover placeholders).
- `layers.js` contains no ESM syntax, no DOM access, no library calls.
- A collapsed class whose module is missing from the map resolves to `null` and
  its edges are dropped (never rendered as dangling links).
- `expanded` is a `Set` of module ids; empty = fully collapsed (files view).

## Key Files
- `index.ts` - `render()` and the marker-injection contract.
- `layers.js` - pure containment-zoom engine (UMD-lite).
- `layers.d.ts` - engine type declarations.
- `template.html` - the self-contained shell (containment-zoom UI, force graph).

## Gotchas
- Editing marker strings in `template.html` without matching `index.ts` (or vice
  versa) silently breaks injection — the placeholder ships verbatim.
- `nearestVisibleAncestor` returns `null` (does not throw) for unknown/orphaned
  ids; callers must drop such edges.
- The shell reuses graph node objects across zoom swaps (matched by id) to
  preserve force-layout positions; new class nodes are seeded near their file.
