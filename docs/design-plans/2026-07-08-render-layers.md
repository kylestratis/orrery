# Renderer Granularity / Layer Views Design

## Summary

Orrery currently renders all nodes — packages, files (modules), and classes — into a single flat graph, which makes large codebases hard to navigate and obscures the natural containment hierarchy. This feature introduces a **containment-zoom model**: the renderer treats the tree `package ⊃ file ⊃ class` as the organizing principle and shows only the *visible frontier* of that tree at any moment. By default the graph opens in a collapsed state — packages and files appear as dots, while classes are hidden inside their files. A global HUD control lets the user expand every file at once to reveal the full class graph, or collapse back to the overview. A second deliverable (same engine, later phase) adds a per-file double-click gesture so individual files can be opened and closed independently.

The implementation rests on a pure, DOM-free engine (`layers.js`) that takes the full `CodeMap` plus the current expansion state and returns only the nodes and edges that should render. Central to this is **edge lifting**: every `uses` or `registers` edge has its endpoints resolved to their nearest visible ancestor, so a dependency between two classes in collapsed files becomes a file→file edge rather than disappearing. Lifted edges are flagged and styled distinctly so the class-level dependency signal survives at overview scale. The engine is wired into the existing `3d-force-graph` renderer by injecting `layers.js` into the self-contained HTML at build time, following the established vendor-injection pattern; no changes to the extraction pipeline or data schema are required.

## Definition of Done

The renderer becomes a **containment zoom** over the tree `package ⊃ module(file) ⊃ class`. Because a class lives in exactly one file, the node hierarchy is a strict tree (even though `import`/`uses` edges cut across it), so "see the files, then open a file to see its classes" is the governing model. Two deliverables, sequenced as separate tasks/phases sharing one engine.

**Deliverable 1 — Containment-zoom engine + global control (primary):**
- The scene renders only the *visible frontier* of the containment tree. Packages and files always render; a file's `class` nodes render only when that file is **expanded**, anchored to their file by a synthesized containment link so they fan out around it.
- Expansion state is a single set `expanded: Set<moduleId>`. A global control in the HUD sets it wholesale: **`collapse all`** (files as dots) ⇄ **`expand all`** (every file opened = the "classes" view). **Default: collapsed (files).**
- **Edge lifting:** every real edge has each endpoint resolved to its nearest *visible* ancestor (a class in a collapsed file → the file dot); resulting self-loops are dropped and parallel edges deduped. So `uses` edges render as file→file, file→class, or class→class depending on what is open. In the collapsed view, `uses` edges appear **lifted to file→file** (styled distinctly from `import`), preserving the class-level dependency signal at overview level.
- The existing per-edge-kind toggles (`import` / `uses` / `registers`) remain as a finer sub-filter; focus/drill, labels, and the cycles toggle still compose.
- A one-line legend caption names the active zoom state. Preserves the single self-contained HTML; scales to large monorepos (collapsed default renders far fewer nodes).

**Deliverable 2 — Per-file expand gesture (separate, later task, same engine):**
- A distinct gesture (not the existing drill/focus single-click) toggles a single file in `expanded`, revealing/hiding just that file's classes + their `uses` edges.
- Selecting a class that lives in a collapsed file (via search or drill) **auto-expands** its file so the target is visible.

**Explicitly out of scope:** any extraction changes; generalizing the hardcoded `NODE_COLORS` / `#about` template assumptions (future issue); function-level zoom (`orrery-487`); collapsing files into packages (only the file↔class level collapses).

**Success looks like:** open the HTML → files as dots + `import` edges + lifted file→file `uses` edges; `expand all` → every file opens to its classes with class-level `uses` edges; `collapse all` → back to files; (deliverable 2) a per-file gesture opens/closes one file, and searching a class auto-expands its file.

## Acceptance Criteria

### render-layers.AC1: Visible frontier (containment)
- **render-layers.AC1.1 Success:** In the collapsed state (empty `expanded`), all package and file (module) nodes are present and zero class nodes are present.
- **render-layers.AC1.2 Success:** When a file is in `expanded`, its class nodes are present, each with a synthesized `contains` (file→class) link.
- **render-layers.AC1.3 Success:** With every file expanded, every class node is present.
- **render-layers.AC1.4 Edge:** Expanding a file that has no classes adds no nodes and raises no error.
- **render-layers.AC1.5 Success:** Package and file nodes are present at every expansion state (only the file↔class level collapses).

### render-layers.AC2: Edge lifting
- **render-layers.AC2.1 Success:** When both endpoint classes are collapsed, a `uses` edge is lifted to file→file.
- **render-layers.AC2.2 Success:** When one endpoint's file is expanded and the other collapsed, the edge is class→file (the far endpoint lifted).
- **render-layers.AC2.3 Success:** When both files are expanded, the edge is class→class (native, unlifted).
- **render-layers.AC2.4 Edge:** A `uses`/`registers` edge targeting a *module* keeps its target (modules are always visible); only a collapsed source lifts (class→module or file→module).

### render-layers.AC3: Global zoom control
- **render-layers.AC3.1 Success:** The HTML opens collapsed by default (files + `import` edges + lifted file→file `uses` edges).
- **render-layers.AC3.2 Success:** `expand all` reveals all classes; `collapse all` returns to files.
- **render-layers.AC3.3 Success:** A legend caption names the active zoom state, and the existing edge-kind toggles, cycles toggle, and focus/drill still function.

### render-layers.AC4: Graph integrity
- **render-layers.AC4.1 Success:** Edge lifting drops self-loops (edges whose endpoints lift to the same node) and dedups parallel edges by `source|target|kind`.
- **render-layers.AC4.2 Edge:** An edge whose endpoint has no visible ancestor is dropped, never rendered as a dangling link.

### render-layers.AC5: Output
- **render-layers.AC5.1 Success:** `bun run orrery build` produces a valid self-contained HTML (no external asset requests) with the engine injected, rendering the collapsed default.
- **render-layers.AC5.2 Success:** Lifted file→file `uses` edges are visually distinct from `import` edges.

### render-layers.AC6: Per-file expand gesture (deliverable 2)
- **render-layers.AC6.1 Success:** The distinct gesture (double-click) on a file toggles just that file's classes; single-click still drills/focuses (unchanged).
- **render-layers.AC6.2 Success:** Searching or drilling to a class in a collapsed file auto-expands that file so the class renders.
- **render-layers.AC6.3 Edge:** The gesture on a file with no classes is a no-op (no error).

## Glossary

- **CodeMap**: The structured data object produced by Orrery's extraction pipeline, containing the full set of nodes (packages, modules/files, classes) and edges (`import`, `uses`, `registers`) for a repository. Embedded into the generated HTML at build time.
- **containment-zoom**: The governing interaction model. The renderer exposes a tree of levels (`package ⊃ file ⊃ class`) and at any moment shows only one *frontier* of that tree; collapsing a level hides its children and promotes edges up to the parent level.
- **visible frontier**: The subset of the containment tree rendered at a given expansion state. Packages and files are always on the frontier; a file's class nodes are on the frontier only when that file is in the `expanded` set.
- **edge lifting**: Resolving each endpoint of an edge to its nearest visible ancestor. A `uses` edge from class A to class B, when both files are collapsed, lifts to a file→file edge. Endpoints that lift to the same node yield a self-loop that is dropped; identical lifted edges are deduplicated.
- **`expanded` (set)**: The single runtime state driving the engine — a `Set<moduleId>` of files whose class children are currently visible. Empty = fully collapsed; all file ids = fully expanded.
- **`buildDisplayGraph`**: The pure function at the heart of the engine. Given the full node/edge sets and the current `expanded` set, returns the `{ nodes, links }` object ready for `Graph.graphData()`.
- **`nearestVisibleAncestor`**: Helper that, given a node id and the expansion state, returns the id of the nearest ancestor currently on the visible frontier. Used to lift edge endpoints.
- **`contains` link**: A synthesized edge (not in the raw `CodeMap`) added for each visible class, connecting its parent file to it, so class nodes anchor around their file in the force layout.
- **`3d-force-graph`**: The third-party JS library (npm: `3d-force-graph`) driving the interactive 3D force-directed graph. Orrery's renderer is a thin shell over it; `Graph.graphData()` replaces the displayed node/edge set.
- **`graphData` swap**: Calling `Graph.graphData(newData)` to replace the visible node/edge set. Re-heats the force simulation (nodes move); the design pins persisting nodes' positions to reduce visual jump.
- **dim-don't-delete**: The existing de-emphasis convention in the template — swap a node/edge color to a near-background value (`DIM_NODE`/`DIM_LINK`) rather than removing it. Containment zoom instead makes hidden nodes absent from `graphData` entirely.
- **vendor injection / `<!--{{VENDOR}}-->`**: The existing mechanism in `src/render/index.ts` that inlines vendored JS into the self-contained HTML at build time via a template marker. `layers.js` follows the same pattern.
- **auto-expand-on-select**: Deliverable-2 behavior: navigating to (searching/drilling) a class whose file is collapsed automatically adds that file to `expanded` so the target becomes visible.
- **drill / focus**: Existing single-click interaction — highlights a node and its neighbors / navigates to it. Distinct from the new double-click expand gesture; single-click behavior is preserved unchanged.

## Architecture

A containment-zoom layer over the existing `3d-force-graph` renderer (`src/render/template.html` + `src/render/index.ts`). No extraction or schema changes — the `CodeMap` already carries node `kind` and each class's `module` (its containing file), which is the only containment signal needed.

**Pure engine (`src/render/layers.js`), plain JS so it is both unit-testable under `bun` and injectable into the self-contained HTML:**

```javascript
// Given the full CodeMap node/edge sets and the current expansion state,
// return the graphData subset to render. Pure: no DOM, no globals.
function buildDisplayGraph(nodes, edges, expanded) // -> { nodes: DisplayNode[], links: DisplayLink[] }

// Resolve a node id to the id of its nearest ancestor that is currently visible
// (a class in a collapsed file resolves to the file id; a visible node resolves
// to itself). Returns null if nothing is visible (should not happen for valid input).
function nearestVisibleAncestor(nodeId, nodesById, expanded) // -> string | null
```

`buildDisplayGraph` produces the visible node set (all packages + files; plus the classes of each `expanded` file), synthesizes a `contains` link (file→class) for each revealed class, then rewrites every real edge (`import`/`uses`/`registers`) by lifting both endpoints via `nearestVisibleAncestor`, dropping self-loops and deduping by `source|target|kind`. A lifted edge carries its original `kind` plus a flag when it was lifted above its native level (so the template can style a lifted file→file `uses` edge distinctly).

**Imperative shell (`src/render/template.html`):** owns the `expanded` set and all DOM/graph wiring. On any change to `expanded`, it recomputes `buildDisplayGraph(...)` and calls `Graph.graphData(...)`. This re-runs the force layout (expected for expand/collapse per the `3d-force-graph` `expandable-nodes` idiom); positions of nodes that persist across the change are pinned (`fx/fy/fz` set from prior coords, released after a short settle) to minimize jump. Existing accessors (`nodeColorAcc`, `linkColorAcc`, `linkWidthAcc`, label overlay, `enabled[kind]` visibility, `showCycles`, focus highlight) are reused; the `contains` link kind and the "lifted" flag are added to their switch logic.

**Render pipeline (`src/render/index.ts`):** currently injects vendored JS via the `<!--{{VENDOR}}-->` marker. Add `layers.js` to the injected script set (read from disk alongside the vendor files and inlined the same way) so the browser has the engine while the HTML stays fully self-contained and offline.

**Data flow:** `CodeMap` → (build time) embedded as `DATA` in the HTML → (runtime) `buildDisplayGraph(DATA.nodes, DATA.edges, expanded)` on each zoom change → `Graph.graphData()` → force layout → accessors paint kinds/dim/lift styling.

## Existing Patterns

Investigation of `src/render/` (the only renderer code; `index.ts` + `template.html`) found:
- **Accessor + repaint, dim-don't-delete:** the template already routes all styling through `nodeColorAcc`/`linkColorAcc`/`linkWidthAcc` and a `repaint()` that re-applies accessors without restarting layout; de-emphasis is done by swapping to a near-background *color* (`DIM_NODE`/`DIM_LINK`) because `3d-force-graph`'s `nodeOpacity` is global. This design reuses those accessors and adds the lifted-edge/`contains` cases.
- **Edge-kind vocabulary:** `KIND_COLORS`, `enabled[kind]`, `adj[kind]`, and per-kind toggles already exist; the design adds a `contains` kind and a lifted style rather than inventing a parallel system.
- **Asset injection:** vendored JS is inlined via a template marker in `index.ts`; `layers.js` follows the same mechanism (new, but consistent with the established injection pattern).
- **Node identity:** class id = `${moduleId}:${ClassName}`, module/package ids are dotted paths — the engine derives containment from these + the `module` field, matching extraction conventions.

Divergence: the current renderer keeps *all* class nodes in `graphData` at once (flat graph, classes unanchored). This design replaces that with the containment-frontier model (classes present only when their file is expanded, anchored by a `contains` link). Justified because the flat model cannot express "open a file to see what's inside," is the source of the commingled-layer confusion this feature exists to fix, and renders far more nodes than necessary on large repos.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Pure containment-zoom engine (`layers.js`) + unit tests
**Goal:** The tested, DOM-free transform that turns `(nodes, edges, expanded)` into renderable graphData with edge lifting.

**Components:**
- `src/render/layers.js` — `buildDisplayGraph(nodes, edges, expanded)` and `nearestVisibleAncestor(nodeId, nodesById, expanded)`: visible-frontier selection (packages + files always; classes of expanded files), `contains` link synthesis, endpoint lifting to nearest visible ancestor, self-loop drop, dedup, and the "lifted" flag on edges promoted above their native level.
- `tests/layers.test.ts` — `bun` unit tests importing `layers.js`.

**Dependencies:** None (pure module).

**Done when:** `bun test` passes covering the ACs this phase claims: render-layers.AC1.1–AC1.5, AC2.1–AC2.4, AC4.1.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Render-pipeline injection + global zoom control
**Goal:** Wire the engine into the self-contained HTML with a global `collapse all`/`expand all` control defaulting to collapsed.

**Components:**
- `src/render/index.ts` — inject `layers.js` source into the template (extend the vendor-injection mechanism / add a marker); no behavior change to data/README embedding.
- `src/render/template.html` — own `expanded: Set<moduleId>` (init empty = collapsed); a segmented `collapse all`/`expand all` control in `#hud`; call `buildDisplayGraph` → `Graph.graphData(...)` on change; extend `nodeColorAcc`/`linkColorAcc`/`linkWidthAcc`/labels for the `contains` kind and lifted file→file `uses` styling; one-line legend caption naming the active zoom state; position-pinning to reduce layout jump.

**Dependencies:** Phase 1.

**Done when:** `bun run orrery build tests/fixtures/repo` yields valid self-contained HTML that opens collapsed (files + `import` + lifted file→file `uses`); `expand all`/`collapse all` switch the scene; existing edge-kind toggles, cycles, focus, and labels still work. Verifies render-layers.AC3.1–AC3.3, AC5.1–AC5.2 (build/interaction — human-verified per test plan; AC coverage for the pure lifting is Phase 1).
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Per-file expand gesture + auto-expand-on-select
**Goal:** Granular per-file drilling (deliverable 2) on the same engine.

**Components:**
- `src/render/template.html` — a distinct gesture (double-click via click-timing; single-click still drills/focuses) toggles one file in `expanded`; search/drill to a class in a collapsed file auto-expands that file; cursor affordance on expandable files.

**Dependencies:** Phase 2.

**Done when:** double-clicking a file opens/closes just its classes; searching or drilling to a class auto-expands its file; single-click focus behavior unchanged. Verifies render-layers.AC6.1–AC6.3 (interaction — human-verified per test plan; the underlying per-file `expanded` transform is already covered by Phase 1 unit tests).
<!-- END_PHASE_3 -->

## Additional Considerations

**Layout stability:** `graphData` swaps re-heat the force simulation (nodes move). Pinning persisting nodes' positions (`fx/fy/fz` from prior coords, released after a short cooldown) keeps expand/collapse legible rather than jarring. This is polish, not correctness — the engine is correct regardless.

**Large monorepos:** collapsed-by-default is the scaling strategy (the overview renders only packages + files + lifted edges). `expand all` on a very large repo is intentionally the heavy case; per-file expansion keeps normal use bounded. No new performance mechanism is introduced beyond what `3d-force-graph` already provides.

**Testing boundary:** only the pure transform (`layers.js`) is unit-tested; interactive/visual behavior (control toggles, gesture, layout, styling) is human-verified via the generated test plan. This is a deliberate boundary given the renderer has no existing browser-test harness and adding one is out of scope.
