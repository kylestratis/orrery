# Renderer Containment Zoom (render-layers) — Phase 2 Implementation Plan

**Goal:** Inject the Phase 1 engine into the self-contained HTML and wire a global `collapse all` ⇄ `expand all` zoom control that defaults to collapsed (files as dots, lifted file→file `uses` edges).

**Architecture:** `src/render/index.ts` gains a `<!--{{LAYERS}}-->` marker replacement that inlines `src/render/layers.js` exactly like the vendor files. `src/render/template.html` becomes the imperative shell: it owns `expanded: Set<moduleId>`, recomputes `buildDisplayGraph(...)` on every zoom change, and swaps `Graph.graphData(...)` while reusing persistent node objects (positions survive; persisting nodes are pinned via `fx/fy/fz` during re-layout and released after settle). Existing accessors are extended for the `contains` kind and the lifted style.

**Tech Stack:** bun, TypeScript (`src/render/index.ts`), vanilla JS in `template.html`, vendored `3d-force-graph` 1.80.0 (already the latest; matches nodes across `graphData` calls by `id`, preserves positions on reused node objects, pins via `fx/fy/fz`, releases with `undefined`).

**Scope:** Phase 2 of 3 from `docs/design-plans/2026-07-08-render-layers.md`. Depends on Phase 1 (`src/render/layers.js` exists, tests green).

**Codebase verified:** 2026-07-08 (line anchors below refer to `src/render/template.html` and `src/render/index.ts` at commit 17dba89; re-anchor by searching for the quoted code if lines drifted).

**Beads issue:** orrery-k97 (claim before starting: `bd update orrery-k97 --claim`).

---

## Acceptance Criteria Coverage

This phase implements and verifies:

### render-layers.AC3: Global zoom control
- **render-layers.AC3.1 Success:** The HTML opens collapsed by default (files + `import` edges + lifted file→file `uses` edges).
- **render-layers.AC3.2 Success:** `expand all` reveals all classes; `collapse all` returns to files.
- **render-layers.AC3.3 Success:** A legend caption names the active zoom state, and the existing edge-kind toggles, cycles toggle, and focus/drill still function.

### render-layers.AC5: Output
- **render-layers.AC5.1 Success:** `bun run orrery build` produces a valid self-contained HTML (no external asset requests) with the engine injected, rendering the collapsed default.
- **render-layers.AC5.2 Success:** Lifted file→file `uses` edges are visually distinct from `import` edges.

AC3.1–AC3.3 and AC5.2 are interaction/visual criteria — human-verified per the test plan (`test-requirements.md`). AC5.1's injection component is covered by an automated test in Task 1; the "no external asset requests" component is human-verified. The pure lifting behavior behind the views is already covered by Phase 1 unit tests.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Inject `layers.js` into the rendered HTML

**Verifies:** render-layers.AC5.1 (injection component, automated)

**Files:**
- Modify: `src/render/index.ts:13-16` (constants) and `:36-39` (replacement chain)
- Modify: `src/render/template.html:88` (add marker)
- Create: `tests/render.test.ts` (unit)

**Step 1: Write the failing test**

Create `tests/render.test.ts` in the existing style (`bun:test`, explicit `.ts` import):

```typescript
import { expect, test } from "bun:test";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "../src/render/index.ts";
import type { CodeMap } from "../src/schema.ts";

const MAP: CodeMap = {
  root: "fixture",
  nodes: [
    { id: "fixture", kind: "package" },
    { id: "fixture.a", kind: "module", parent: "fixture" },
    { id: "fixture.a:A", kind: "class", module: "fixture.a" },
  ],
  edges: [],
};

test("render inlines the containment-zoom engine and resolves all markers", () => {
  const out = join(mkdtempSync(join(tmpdir(), "orrery-render-")), "map.html");
  render(MAP, { out });
  const html = readFileSync(out, "utf8");
  expect(html.includes("function buildDisplayGraph")).toBe(true);
  expect(html.includes("<!--{{LAYERS}}-->")).toBe(false);
  expect(html.includes("<!--{{VENDOR}}-->")).toBe(false);
  expect(html.includes("/*{{DATA}}*/ null")).toBe(false);
});
```

Run: `bun test tests/render.test.ts`
Expected: fails — `buildDisplayGraph` absent and `<!--{{LAYERS}}-->` check fails only after the marker exists, so initially the first assertion fails.

**Step 2: Add the marker to the template**

In `src/render/template.html`, line 88 currently reads:

```html
<!--{{VENDOR}}-->
```

Add the layers marker on the next line so the engine loads after the vendor libs and before the main script:

```html
<!--{{VENDOR}}-->
<!--{{LAYERS}}-->
```

**Step 3: Inject in `src/render/index.ts`**

After the existing constants (line 16), add:

```typescript
const LAYERS = join(HERE, "layers.js");
```

In the replacement chain (lines 36-39), add a replacement after the VENDOR one (function replacement, same `$&`-safety rationale as the existing comment):

```typescript
    .replace("<!--{{VENDOR}}-->", () => vendor)
    .replace("<!--{{LAYERS}}-->", () => `<script>\n${readFileSync(LAYERS, "utf8")}\n</script>`)
```

**Step 4: Run tests**

Run: `bun test`
Expected: all pass (new render test green, Phase 1 suite untouched).

**Step 5: Commit**

```bash
git add src/render/index.ts src/render/template.html tests/render.test.ts
git commit -m "feat(render): inline layers.js engine into self-contained HTML (orrery-k97)"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Containment-zoom shell in `template.html`

**Verifies:** render-layers.AC3.1, AC3.2, AC3.3, AC5.2 (human-verified; this task builds the behavior)

**Files:**
- Modify: `src/render/template.html` (all edits below; anchors are pre-edit line numbers)

All engine calls are global functions (`buildDisplayGraph`) because `layers.js` is inlined as a classic script (its UMD tail attaches to `globalThis`).

**Step 1: HUD controls and caption (lines 61-72)**

Inside `#hud`, insert a zoom row between the search input (line 64) and the toggles div (line 65):

```html
  <div style="display:flex; gap:6px; margin-bottom:8px;">
    <button id="collapse-all">▣ collapse all</button>
    <button id="expand-all">▤ expand all</button>
  </div>
  <div id="zoom-state" style="color:#8aa0c0; font-size:11px; margin-bottom:6px;"></div>
```

**Step 2: Colors (line 109)**

Replace:

```javascript
const KIND_COLORS = { import: '#3a4a63', uses: '#e8923c', registers: '#4cc9f0' };
```

with:

```javascript
const KIND_COLORS = { import: '#3a4a63', uses: '#e8923c', registers: '#4cc9f0', contains: '#2c3547' };
// Lifted edges (endpoints promoted above their native level) keep their kind's
// hue but darker, so class-level signal reads distinctly at file scale.
const LIFTED_TINT = { uses: '#b5701f', registers: '#2e8aa8' };
```

**Step 3: Replace the static link set with zoom state (line 147)**

Delete line 147 (`const ALL_LINKS = DATA.edges.map(...)`; keep lines 148-149, `endId`/`linkId`). In its place add:

```javascript
// ---- containment zoom (engine: layers.js, inlined) ----
const MODULE_IDS = DATA.nodes.filter(n => n.kind === 'module').map(n => n.id);
const classCount = new Map();
for (const n of DATA.nodes)
  if (n.kind === 'class') classCount.set(n.module, (classCount.get(n.module) || 0) + 1);
const expanded = new Set();        // module ids whose classes are visible; empty = collapsed

// Node objects persist across graphData swaps so the force layout keeps
// positions for nodes that survive a zoom change (matched by id).
const graphNodeById = new Map();
function graphNode(n) {
  let g = graphNodeById.get(n.id);
  if (!g) {
    g = { ...n };
    if (n.kind === 'class') {
      // seed new classes near their file so they fan out from it, not from origin
      const m = graphNodeById.get(n.module);
      if (m && m.x != null) {
        g.x = m.x + (Math.random() - 0.5) * 14;
        g.y = m.y + (Math.random() - 0.5) * 14;
        g.z = m.z + (Math.random() - 0.5) * 14;
      }
    }
    graphNodeById.set(n.id, g);
  }
  return g;
}

let displayLinks = [];             // links currently rendered (render direction)
let settleTimer = null;

// Recompute the visible frontier and swap it in. Persisting nodes are pinned
// (fx/fy/fz) through the re-layout and released after a settle window so
// expand/collapse reads as local change, not a full re-shuffle.
function applyZoom() {
  const dg = buildDisplayGraph(DATA.nodes, DATA.edges, expanded);
  const prevIds = new Set(Graph.graphData().nodes.map(n => n.id));
  const nodes = dg.nodes.map(graphNode);
  // Real edges render provider -> consumer so the arrowhead points at the
  // dependent (same convention the static ALL_LINKS used); `contains` links
  // are structural (file -> class) and get no arrow.
  displayLinks = dg.links.map(l => l.kind === 'contains'
    ? { source: l.source, target: l.target, kind: l.kind, lifted: false }
    : { source: l.target, target: l.source, kind: l.kind, lifted: !!l.lifted });
  for (const n of nodes)
    if (prevIds.has(n.id) && n.x != null) { n.fx = n.x; n.fy = n.y; n.fz = n.z; }
  Graph.graphData({ nodes, links: displayLinks });
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    for (const n of Graph.graphData().nodes) { n.fx = n.fy = n.fz = undefined; }
  }, 1500);
  // updateLabels only touches rendered nodes, so explicitly hide labels of
  // nodes that just left the frontier.
  const visible = new Set(nodes.map(n => n.id));
  for (const [id, el] of labelEls) if (!visible.has(id)) el.style.display = 'none';
  computeHighlight(); repaint(); updateZoomCaption();
}

function updateZoomCaption() {
  const el = document.getElementById('zoom-state');
  el.textContent = expanded.size === 0 ? 'zoom: files (collapsed)'
    : expanded.size >= MODULE_IDS.length ? 'zoom: classes (all files expanded)'
    : `zoom: mixed (${expanded.size} file${expanded.size === 1 ? '' : 's'} open)`;
}
```

**Step 4: Highlight over the displayed links (lines 172-180)**

In `computeHighlight`, replace the `ALL_LINKS` loop:

```javascript
  for (const l of displayLinks)
    if ((endId(l.source) === focus || endId(l.target) === focus) &&
        (l.kind === 'contains' || enabled[l.kind]))
      highlightLinks.add(linkId(l));
```

**Step 5: Accessors (lines 188-199)**

Replace `linkColorAcc` and `linkWidthAcc`:

```javascript
function linkColorAcc(l) {
  if (showCycles) {
    const s = nodeById.get(endId(l.source)), t = nodeById.get(endId(l.target));
    return (l.kind === 'import' && s && t && s.cycle != null && s.cycle === t.cycle)
      ? CYCLE_COLOR : DIM_LINK;
  }
  if (focus && !highlightLinks.has(linkId(l))) return DIM_LINK;
  if (l.lifted) return LIFTED_TINT[l.kind] || KIND_COLORS[l.kind];
  return KIND_COLORS[l.kind];
}
function linkWidthAcc(l) {
  if (focus && highlightLinks.has(linkId(l))) return 2.4;
  if (l.kind === 'contains') return 0.5;
  if (l.lifted) return 1.8;
  return l.kind === 'import' ? 0.5 : 1.2;
}
```

**Step 6: Graph construction (lines 238-254)**

- Line 246: change `.linkVisibility(l => enabled[l.kind])` to `.linkVisibility(l => l.kind === 'contains' || enabled[l.kind])` (contains has no toggle; always on).
- Line 249: change the arrow accessor to `.linkDirectionalArrowLength(l => (l.kind === 'contains' ? 0 : l.kind === 'import' ? 2.5 : 3.2))`.
- Line 254: delete the `.graphData({ nodes: DATA.nodes.map(n => ({ ...n })), links: ALL_LINKS });` call (end the chain at `.onNodeClick(...)` followed by `;`). The initial population happens via `applyZoom()` in Step 8.

Also update the comment on line 237 — it says "full graph rendered once"; replace with `// ---- 3d-force-graph (renders the visible containment frontier; see applyZoom) ----`.

**Step 7: repaint + wiring (lines 258-264, 340-362)**

- In `repaint()` (line 261): same `linkVisibility` change as Step 6.
- After the reset/back handlers (line 291), add:

```javascript
document.getElementById('collapse-all').onclick = () => { expanded.clear(); applyZoom(); };
document.getElementById('expand-all').onclick = () => { for (const id of MODULE_IDS) expanded.add(id); applyZoom(); };
```

- Legend (line 359-362): append a lifted swatch inside the existing template string chain:

```javascript
  + `<span><span class="sw" style="background:${LIFTED_TINT.uses}"></span> uses (lifted)</span>`
```

**Step 8: Bootstrap (lines 421-424)**

Replace the closing calls:

```javascript
buildLabels();
applyZoom();                       // initial frontier: collapsed (files)
updateCrumb();
setTimeout(() => { if (!focus) Graph.zoomToFit(700, 60); }, 1500);
flyTick();
```

**Step 9: Verify**

Run: `bun test`
Expected: all pass.

Run: `bun run orrery build tests/fixtures/repo --out /tmp/orrery-render-layers/fixture.html`
Expected: `orrery: 3 packages, 13 modules, 17 edges → /tmp/orrery-render-layers/fixture.html` and the file exists.

**Step 10: Commit**

```bash
git add src/render/template.html
git commit -m "feat(render): global containment-zoom control, collapsed default (orrery-k97)"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Human smoke test + close out

**Verifies:** render-layers.AC3.1, AC3.2, AC3.3, AC5.1, AC5.2 (human)

**Step 1: Build and open the fixture map**

```bash
bun run orrery build tests/fixtures/repo --out /tmp/orrery-render-layers/fixture.html --open
```

Walk the checklist (also captured in `test-requirements.md`):
1. Opens collapsed: package + module dots only, zero class nodes; `import` edges (thin blue-grey) plus lifted `uses` edges (darker orange, thicker) between files; caption reads "zoom: files (collapsed)". (AC3.1, AC5.2)
2. `expand all`: 12 class nodes appear anchored around their files via faint `contains` links; class→class `uses` edges show bright orange; caption reads "zoom: classes (all files expanded)". `collapse all` returns to state 1. (AC3.2)
3. Edge-kind toggles still hide/show `import`/`uses`/`registers`; the cycles toggle still repaints; clicking a node still drills/focuses; labels toggle works; search still jumps to modules. (AC3.3)
4. DevTools Network tab: no external requests after load (file:// self-contained). (AC5.1)

**Step 2: Update trackers**

```bash
bd close orrery-k97 --reason="Engine injected; global collapse/expand control live; smoke test passed (AC3.*, AC5.*)"
deciduous add outcome "Phase 2 complete: containment zoom wired into HTML, collapsed default" -c 90 --commit HEAD
```
<!-- END_TASK_3 -->
