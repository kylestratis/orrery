# render-layers — Test Requirements

**Purpose:** Map every acceptance criterion in `docs/design-plans/2026-07-08-render-layers.md`
(render-layers.AC1.1 … render-layers.AC6.3) to how it is verified. Consumed by the
test-analyst agent during execution.

Each criterion maps to exactly one category, with one documented exception: **AC5.1 is
split** — its "engine injected" component is automated (`tests/render.test.ts`), and its
"no external asset requests" component is human-verified. This split is called out
explicitly in the design's Phase 2 plan.

**Two categories:**
- **Automated** — pure-engine behavior covered by `bun test`. `tests/layers.test.ts`
  covers AC1.\*, AC2.\*, AC4.\*; `tests/render.test.ts` covers the injection component of
  AC5.1.
- **Human verification** — interaction/visual behavior in the generated 3D HTML. There is
  **no browser test harness by explicit design decision** (see the design's "Testing
  boundary": only the pure `layers.js` transform is unit-tested; the renderer has no
  existing browser-test harness and adding one is out of scope). Covers AC3.1–3.3, AC5.1's
  no-external-requests component, AC5.2, AC6.1–6.3.

---

## Automated

Run: `bun test`. Test-file paths are fixed by the phase plans.

| AC | Text | Type | Test file | Asserts |
|----|------|------|-----------|---------|
| render-layers.AC1.1 | In the collapsed state (empty `expanded`), all package and file (module) nodes are present and zero class nodes are present. | unit | `tests/layers.test.ts` | `buildDisplayGraph(NODES, EDGES, new Set())` node ids are exactly `{app, app.a, app.b, app.empty}` and no node has `kind === "class"`. |
| render-layers.AC1.2 | When a file is in `expanded`, its class nodes are present, each with a synthesized `contains` (file→class) link. | unit | `tests/layers.test.ts` | With `expanded = {app.a}`, `app.a:A1`/`app.a:A2` present, `contains` links `app.a->app.a:A1` and `app.a->app.a:A2` present; `app.b:B1` absent, no `contains` for `app.b`. |
| render-layers.AC1.3 | With every file expanded, every class node is present. | unit | `tests/layers.test.ts` | With `expanded = ALL_MODULES`, all 7 fixture node ids are present. |
| render-layers.AC1.4 | Expanding a file that has no classes adds no nodes and raises no error. | unit | `tests/layers.test.ts` | With `expanded = {app.empty}`, node set equals the AC1.1 collapsed set and the call does not throw. |
| render-layers.AC1.5 | Package and file nodes are present at every expansion state (only the file↔class level collapses). | unit | `tests/layers.test.ts` | `{app, app.a, app.b, app.empty} ⊆ node ids` in collapsed, single-expanded, and all-expanded states. |
| render-layers.AC2.1 | When both endpoint classes are collapsed, a `uses` edge is lifted to file→file. | unit | `tests/layers.test.ts` | Collapsed: exactly one `uses` link `app.a->app.b` with `lifted === true`; native `import app.a->app.b` present with `lifted` falsy. |
| render-layers.AC2.2 | When one endpoint's file is expanded and the other collapsed, the edge is class→file (the far endpoint lifted). | unit | `tests/layers.test.ts` | With `expanded = {app.a}`: `uses app.a:A1->app.b` and `app.a:A2->app.b` both `lifted === true`; no `uses app.a->app.b`. |
| render-layers.AC2.3 | When both files are expanded, the edge is class→class (native, unlifted). | unit | `tests/layers.test.ts` | With `expanded = ALL_MODULES`: `uses app.a:A1->app.b:B1` and `app.a:A2->app.b:B1` present with `lifted` falsy. |
| render-layers.AC2.4 | A `uses`/`registers` edge targeting a *module* keeps its target (modules are always visible); only a collapsed source lifts (class→module or file→module). | unit | `tests/layers.test.ts` | With `expanded = ALL_MODULES`: class→module edge `app.a:A1->app.b` (`uses`) present unchanged, `lifted` falsy (target kept); collapsed, its source-only lift merges onto the `app.a->app.b` lifted key. |
| render-layers.AC4.1 | Edge lifting drops self-loops (edges whose endpoints lift to the same node) and dedups parallel edges by `source\|target\|kind`. | unit | `tests/layers.test.ts` | Collapsed: no `uses` link with `source === target` (no `app.a->app.a`); intra-file edge renders natively `app.a:A1->app.a:A2` when `app.a` expanded; exactly one `uses app.a->app.b` (parallel raw edges OR-merge `lifted`). |
| render-layers.AC4.2 | An edge whose endpoint has no visible ancestor is dropped, never rendered as a dangling link. | unit | `tests/layers.test.ts` | In all three states: no link whose source or target is `app.ghost:X` or `app.ghost`; `nearestVisibleAncestor` returns `null` for unknown ids and for a class whose module is absent from the map. |
| render-layers.AC5.1 *(injection component only)* | `bun run orrery build` produces a valid self-contained HTML (…) with the engine injected, rendering the collapsed default. | unit (integration-ish; drives `render()`) | `tests/render.test.ts` | `render(MAP, {out})` output HTML contains `function buildDisplayGraph`; markers `<!--{{LAYERS}}-->`, `<!--{{VENDOR}}-->`, and `/*{{DATA}}*/ null` are all resolved (absent). |

---

## Human verification

No browser test harness exists (deliberate design boundary — the interactive shell in
`template.html`, the force layout, DOM controls, gestures, and edge styling cannot be
asserted by `bun test`). Verify these by building the fixture and inspecting the 3D scene.

**Build command (all procedures):**
```bash
bun run orrery build tests/fixtures/repo --out /tmp/orrery-render-layers/fixture.html --open
```

**Fixture shape (use as expected counts):** 3 packages, 13 modules, 12 classes,
8 `import` edges, 9 `uses` edges.

### Phase 2 — global zoom control & output (AC3.1, AC3.2, AC3.3, AC5.1 no-external, AC5.2)

1. **AC3.1 / AC5.2 — collapsed default & lifted-edge distinctness.** On load, the scene
   shows only package + module dots (zero class nodes). Confirm `import` edges render thin
   blue-grey and lifted `uses` edges render darker orange and thicker (`LIFTED_TINT.uses`,
   width 1.8 vs 1.2) — visually distinct from `import`. The caption reads
   **"zoom: files (collapsed)"**.
   - *AC3.1:* "The HTML opens collapsed by default (files + `import` edges + lifted file→file `uses` edges)."
   - *AC5.2:* "Lifted file→file `uses` edges are visually distinct from `import` edges."
2. **AC3.2 — global expand/collapse.** Click **expand all**: all 12 class nodes appear,
   each anchored around its file by a faint `contains` link; class→class `uses` edges show
   bright orange; caption reads **"zoom: classes (all files expanded)"**. Click
   **collapse all**: the scene returns exactly to step 1.
   - *AC3.2:* "`expand all` reveals all classes; `collapse all` returns to files."
3. **AC3.3 — legend caption + composed controls.** Confirm the caption names the active
   zoom state (as seen in steps 1–2). Then verify the pre-existing controls still work
   over the containment frontier: edge-kind toggles hide/show `import`/`uses`/`registers`;
   the cycles toggle repaints; clicking a node still drills/focuses; the labels toggle
   works; search still jumps to modules.
   - *AC3.3:* "A legend caption names the active zoom state, and the existing edge-kind toggles, cycles toggle, and focus/drill still function."
4. **AC5.1 (no-external-requests component).** Open DevTools → Network, reload the
   `file://` page. Confirm **no external asset requests** occur after load (fully
   self-contained/offline). The engine-injected + valid-HTML + collapsed-default parts of
   AC5.1 are covered automatically (`tests/render.test.ts`) and by steps 1–2.
   - *AC5.1:* "`bun run orrery build` produces a valid self-contained HTML (no external asset requests) with the engine injected, rendering the collapsed default."

### Phase 3 — per-file expand gesture (AC6.1, AC6.2, AC6.3)

The single-module `expanded` transform underneath these gestures is already covered by
Phase 1 unit tests (AC1.2, AC2.2); only the interaction wiring is human-verified.

5. **AC6.1 — double-click toggles one file; single-click unchanged.** From the collapsed
   default, double-click a file with classes (e.g. `base` under `repo.web`): only that
   file's classes appear, fanned around it; other files stay closed. Double-click it again:
   it closes. Then confirm a single-click on any node still drills/focuses exactly as
   before — including the first click of a double-click, which drills with zero delay.
   - *AC6.1:* "The distinct gesture (double-click) on a file toggles just that file's classes; single-click still drills/focuses (unchanged)."
6. **AC6.2 — auto-expand on select.** With everything collapsed, search for a class (e.g.
   `Circle`, press Enter): its containing file auto-expands and the view flies to the
   class. Repeat via a module's "classes here" detail list — clicking a class there also
   auto-expands its file and focuses it.
   - *AC6.2:* "Searching or drilling to a class in a collapsed file auto-expands that file so the class renders."
7. **AC6.3 — no-op on a class-free file.** Double-click a module dot that has no classes
   (pick any module that stays childless under `expand all`, e.g. a helper module such as
   `repo.pkg.helpers` if class-free): nothing changes and no console errors appear.
   - *AC6.3:* "The gesture on a file with no classes is a no-op (no error)."
8. **Sanity (supports AC3.3/AC6.1 boundaries, not its own AC).** In a mixed state the
   caption reads "zoom: mixed (N files open)"; `collapse all` / `expand all` still override
   the per-file state wholesale.
