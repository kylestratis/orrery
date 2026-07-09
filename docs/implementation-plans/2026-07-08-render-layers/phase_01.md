# Renderer Containment Zoom (render-layers) — Phase 1 Implementation Plan

**Goal:** Build the pure, DOM-free containment-zoom engine (`src/render/layers.js`) that turns `(nodes, edges, expanded)` into renderable graph data with edge lifting, plus its bun unit tests.

**Architecture:** A plain-JavaScript module with two pure functions: `nearestVisibleAncestor` resolves any node id to its nearest visible ancestor given the expansion state, and `buildDisplayGraph` selects the visible frontier (packages + modules always; classes only when their module is expanded), synthesizes `contains` links, lifts every real edge's endpoints, drops self-loops, and dedups parallel edges. The file is UMD-style (no ESM `export` keyword) so it can be inlined into the self-contained HTML as a classic `<script>` in Phase 2 while remaining importable by bun tests.

**Tech Stack:** Plain JavaScript (ES2020), bun test (`bun:test` `expect`/`test`). No dependencies.

**Scope:** Phase 1 of 3 from `docs/design-plans/2026-07-08-render-layers.md`.

**Codebase verified:** 2026-07-08 (codebase-investigator: schema in `src/schema.ts`, no existing `src/render/layers.js` or `tests/layers.test.ts`, tests run via `bun test`, fixture at `tests/fixtures/repo`).

**Beads issue:** orrery-318 (claim before starting: `bd update orrery-318 --claim`).

---

## Acceptance Criteria Coverage

This phase implements and tests:

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

### render-layers.AC4: Graph integrity
- **render-layers.AC4.1 Success:** Edge lifting drops self-loops (edges whose endpoints lift to the same node) and dedups parallel edges by `source|target|kind`.
- **render-layers.AC4.2 Edge:** An edge whose endpoint has no visible ancestor is dropped, never rendered as a dangling link.

---

## Context an executor needs (read before Task 1)

**Data shapes** (from `src/schema.ts`; extraction produces exactly these three node kinds):

- Node: `{ id: string, kind: "package" | "module" | "class", parent?: string | null, module?: string, ... }`
  - Package/module ids are dotted paths (`repo.web`, `repo.web.base`).
  - Class ids are `${moduleId}:${ClassName}` (`repo.web.base:Base`), and class nodes carry `module: "repo.web.base"` — **`module` is the only containment signal the engine uses**; do not parse ids.
- Edge: `{ source: string, target: string, kind: "import" | "uses" | "registers" }` (schema also allows `"calls"`; the engine treats every kind uniformly, so no special handling is needed).

**Engine contract decisions (fixed by design + planning; do not revisit):**

1. **Semantic direction.** The engine returns links in CodeMap direction (`source → target`, dependency points at what it depends on). The template's existing arrow-reversal for rendering (`template.html:147`) stays in the imperative shell (Phase 2). The engine knows nothing about arrows.
2. **Visibility rule.** A node is on the visible frontier iff `kind !== 'class'`, or its `module` is in `expanded`. Packages and modules never collapse (design: only the file↔class level collapses).
3. **`contains` links** are synthesized file→class for every *visible* class: `{ source: moduleId, target: classId, kind: 'contains', lifted: false }`.
4. **Lifted flag.** A real edge is `lifted: true` when either endpoint moved during lifting. When dedup merges several raw edges onto one displayed key, `lifted` is OR-merged: if *any* constituent was lifted, the displayed edge is lifted. Rationale: the lifted style exists to signal "there are class-level relations beneath this edge"; a coincident native module-level edge does not erase that signal.
5. **Dropped edges.** An endpoint id that is unknown (not in `nodesById`), or a class whose `module` is not in the map, resolves to `null` → the edge is dropped (AC4.2). Endpoints lifting to the same id → self-loop → dropped (AC4.1).
6. **Node references.** `buildDisplayGraph` returns references to the input node objects (no copies). The shell owns copying/position state (Phase 2).
7. **UMD-style module.** No `export`/`import` keywords. Guarded `module.exports` for bun; `globalThis` attachment for the inlined classic `<script>`. Bun's CJS↔ESM interop lets tests do `import { buildDisplayGraph } from "../src/render/layers.js"`.

**Project conventions:** docstrings on every function (JS: JSDoc following Google style intent — summary line, Args/Returns semantics in prose); conventional commits with the beads id suffix, e.g. `feat(render): ... (orrery-318)`.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Failing unit tests for the engine

**Verifies:** render-layers.AC1.1, AC1.2, AC1.3, AC1.4, AC1.5, AC2.1, AC2.2, AC2.3, AC2.4, AC4.1, AC4.2

**Files:**
- Create: `tests/layers.test.ts` (unit)

**Step 1: Write the test file**

Follow the existing test style (`tests/extract.test.ts`): `import { expect, test } from "bun:test"`, small per-file helpers, `Set`-based assertions. Import the engine with an explicit `.js` extension:

```typescript
import { buildDisplayGraph, nearestVisibleAncestor } from "../src/render/layers.js";
```

Define one shared inline fixture at the top of the file (typed loosely, e.g. `const NODES = [...]`, `const EDGES = [...]` — plain object literals mirroring extraction shapes):

```typescript
const NODES = [
  { id: "app", kind: "package" },
  { id: "app.a", kind: "module", parent: "app" },
  { id: "app.b", kind: "module", parent: "app" },
  { id: "app.empty", kind: "module", parent: "app" }, // module with no classes
  { id: "app.a:A1", kind: "class", module: "app.a" },
  { id: "app.a:A2", kind: "class", module: "app.a" },
  { id: "app.b:B1", kind: "class", module: "app.b" },
];
const EDGES = [
  { source: "app.a:A1", target: "app.b:B1", kind: "uses" },    // cross-file class→class
  { source: "app.a:A2", target: "app.b:B1", kind: "uses" },    // parallel to the above once lifted (dedup)
  { source: "app.a:A1", target: "app.a:A2", kind: "uses" },    // intra-file (self-loop when collapsed)
  { source: "app.a:A1", target: "app.b", kind: "uses" },       // class→module (AC2.4)
  { source: "app.a", target: "app.b", kind: "import" },        // native module→module
  { source: "app.a:A1", target: "app.ghost:X", kind: "uses" }, // unknown target (AC4.2)
];
const ALL_MODULES = new Set(["app.a", "app.b", "app.empty"]);
```

Useful helpers (mirror `tests/extract.test.ts` style):

```typescript
const nodeIds = (g: { nodes: { id: string }[] }) => new Set(g.nodes.map((n) => n.id));
const linkKeys = (g: { links: { source: string; target: string; kind: string }[] }) =>
  new Set(g.links.map((l) => `${l.source}->${l.target}:${l.kind}`));
const find = (g: any, source: string, target: string, kind: string) =>
  g.links.find((l: any) => l.source === source && l.target === target && l.kind === kind);
```

Write these tests (one `test(...)` per AC case, named with the AC id so coverage is auditable):

- **AC1.1** — `buildDisplayGraph(NODES, EDGES, new Set())`: node ids are exactly `{app, app.a, app.b, app.empty}`; no node with `kind === "class"`.
- **AC1.2** — `expanded = new Set(["app.a"])`: `app.a:A1` and `app.a:A2` present; `contains` links `app.a->app.a:A1` and `app.a->app.a:A2` present (kind `contains`); `app.b:B1` absent; no `contains` link for `app.b`.
- **AC1.3** — `expanded = ALL_MODULES`: all 7 fixture node ids present.
- **AC1.4** — `expanded = new Set(["app.empty"])`: node set identical to the AC1.1 collapsed set; the call does not throw.
- **AC1.5** — for each of the three states above, `{app, app.a, app.b, app.empty}` ⊆ node ids.
- **AC2.1** — collapsed: exactly one `uses` link `app.a->app.b`, with `lifted === true` (the three raw uses edges that land on this key — two class→class plus the class→module — dedup to one). The native `import` link `app.a->app.b` is also present and `lifted` is falsy on it.
- **AC2.2** — `expanded = new Set(["app.a"])`: exactly one `uses` link `app.a:A1->app.b` with `lifted === true` (class→file: B1's endpoint lifted; the raw native class→module edge merges onto the same key and lifted stays true per OR-merge). Also `app.a:A2->app.b` (`uses`, lifted) present. No `uses` link `app.a->app.b`.
- **AC2.3** — `expanded = ALL_MODULES`: `uses` links `app.a:A1->app.b:B1` and `app.a:A2->app.b:B1` present with `lifted` falsy.
- **AC2.4** — `expanded = ALL_MODULES`: the class→module edge `app.a:A1->app.b` (`uses`) is present unchanged with `lifted` falsy (target kept — modules always visible). Collapsed: the same raw edge contributes to the lifted `app.a->app.b` key (source lifted only), already asserted in AC2.1.
- **AC4.1 self-loop** — collapsed: no `uses` link with `source === target`; specifically no `app.a->app.a`. With `expanded = new Set(["app.a"])`: the intra-file edge renders natively as `app.a:A1->app.a:A2`.
- **AC4.1 dedup** — collapsed: `g.links.filter(l => l.kind === "uses" && l.source === "app.a" && l.target === "app.b").length === 1`.
- **AC4.2** — in all three states: no link whose source or target is `app.ghost:X` or `app.ghost`.
- **nearestVisibleAncestor unit tests** (own `test` block, small local `nodesById = new Map(NODES.map(n => [n.id, n]))`):
  - module id → itself; package id → itself (any expansion state).
  - `app.a:A1` with empty expanded → `"app.a"`; with `app.a` expanded → `"app.a:A1"`.
  - unknown id (`"nope"`) → `null`.
  - a class whose module is missing from the map → `null`: use a local two-node fixture `[{ id: "x:Orphan", kind: "class", module: "x.gone" }]`.

**Step 2: Run tests to verify they fail**

Run: `bun test tests/layers.test.ts`
Expected: failure resolving `../src/render/layers.js` (module not found) — every test fails.

**Step 3: Do not commit yet**

The red test is committed together with the implementation in Task 2, so every commit keeps `bun test` green.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement `src/render/layers.js`

**Verifies:** render-layers.AC1.1–AC1.5, AC2.1–AC2.4, AC4.1, AC4.2 (turns Task 1 green)

**Files:**
- Create: `src/render/layers.js`

**Step 1: Write the module**

Complete implementation (this is the core deliverable — use as written; JSDoc kept in line with the project's documentation rule):

```javascript
/**
 * Containment-zoom engine: pure transform from the full CodeMap plus the
 * current expansion state to the subset of nodes/links to render.
 *
 * No DOM, no globals, no library dependencies — unit-testable under bun and
 * inlinable into the self-contained HTML as a classic <script> (UMD-style
 * tail below; no ESM syntax in this file).
 */

/**
 * Resolve a node id to the id of its nearest ancestor on the visible
 * frontier. Non-class nodes (packages, modules) are always visible and
 * resolve to themselves; a class resolves to itself when its module is
 * expanded, otherwise to its module. Returns null when the id is unknown
 * or a collapsed class's module is missing from the map (callers drop
 * such edges rather than render a dangling link).
 *
 * @param {string} nodeId - Id to resolve.
 * @param {Map<string, object>} nodesById - All CodeMap nodes keyed by id.
 * @param {Set<string>} expanded - Module ids whose classes are visible.
 * @returns {string | null} Visible ancestor id, or null.
 */
function nearestVisibleAncestor(nodeId, nodesById, expanded) {
  const node = nodesById.get(nodeId);
  if (!node) return null;
  if (node.kind !== 'class') return nodeId;
  if (expanded.has(node.module)) return nodeId;
  return nodesById.has(node.module) ? node.module : null;
}

/**
 * Build the displayable graph for the current expansion state: the visible
 * frontier (packages + modules always; classes of expanded modules), a
 * synthesized `contains` link (module→class) anchoring each visible class,
 * and every real edge with endpoints lifted to their nearest visible
 * ancestor. Self-loops produced by lifting are dropped; parallel links are
 * deduped by `source|target|kind` with `lifted` OR-merged across the raw
 * edges that share a key. Links keep CodeMap direction (source → target);
 * the rendering shell owns any arrow-direction conventions.
 *
 * @param {object[]} nodes - Full CodeMap node set.
 * @param {object[]} edges - Full CodeMap edge set.
 * @param {Set<string>} expanded - Module ids whose classes are visible.
 * @returns {{ nodes: object[], links: object[] }} References into `nodes`,
 *   plus links of shape { source, target, kind, lifted }.
 */
function buildDisplayGraph(nodes, edges, expanded) {
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const visible = nodes.filter(
    (n) => n.kind !== 'class' || expanded.has(n.module),
  );

  const links = [];
  for (const n of visible) {
    if (n.kind === 'class') {
      links.push({ source: n.module, target: n.id, kind: 'contains', lifted: false });
    }
  }

  const byKey = new Map();
  for (const e of edges) {
    const source = nearestVisibleAncestor(e.source, nodesById, expanded);
    const target = nearestVisibleAncestor(e.target, nodesById, expanded);
    if (!source || !target || source === target) continue;
    const lifted = source !== e.source || target !== e.target;
    const key = `${source}|${target}|${e.kind}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.lifted = prev.lifted || lifted;
      continue;
    }
    const link = { source, target, kind: e.kind, lifted };
    byKey.set(key, link);
    links.push(link);
  }

  return { nodes: visible, links };
}

// UMD-lite: CommonJS export for bun tests; globals for the inlined <script>.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildDisplayGraph, nearestVisibleAncestor };
} else {
  globalThis.buildDisplayGraph = buildDisplayGraph;
  globalThis.nearestVisibleAncestor = nearestVisibleAncestor;
}
```

**Step 2: Run the tests**

Run: `bun test tests/layers.test.ts`
Expected: all tests pass.

Run: `bun test`
Expected: full suite passes (no regressions).

**Step 3: Commit**

```bash
git add src/render/layers.js tests/layers.test.ts
git commit -m "feat(render): containment-zoom engine with edge lifting (orrery-318)"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Close out Phase 1

**Verifies:** None (bookkeeping).

**Step 1: Full quality gate**

Run: `bun test`
Expected: all tests pass.

**Step 2: Update trackers**

```bash
bd close orrery-318 --reason="layers.js engine + unit tests green (AC1.*, AC2.*, AC4.*)"
deciduous add outcome "Phase 1 complete: layers.js engine + tests green" -c 95 --commit HEAD
# link the outcome to the phase's action node (create one when starting the phase)
```
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
