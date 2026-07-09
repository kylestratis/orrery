# Renderer Containment Zoom (render-layers) — Phase 3 Implementation Plan

**Goal:** Per-file expand gesture (double-click toggles one file's classes) and auto-expand-on-select (navigating to a class in a collapsed file opens that file), on the Phase 1/2 engine.

**Architecture:** Template-only changes. Double-click is implemented with the click-timing pattern inside the existing `onNodeClick` handler (3d-force-graph has no native double-click event — confirmed against the library's issue tracker): the first click drills as today (single-click behavior fully preserved, no delay), and a second click on the same module within the double-click window toggles it in `expanded`. `drillTo` gains auto-expand: when the target is a class whose module is collapsed, the module is added to `expanded` and the frontier recomputed before focusing, so search hits and detail-panel clicks always land on a visible node.

**Tech Stack:** vanilla JS in `src/render/template.html`; engine and `applyZoom()` shell from Phases 1-2.

**Scope:** Phase 3 of 3 from `docs/design-plans/2026-07-08-render-layers.md`. Depends on Phase 2.

**Codebase verified:** 2026-07-08 (anchors are pre-Phase-2 line numbers in `src/render/template.html`; after Phase 2 lands, locate the quoted code by search — the structures this phase touches, `onNodeClick` and `drillTo`, are stable).

**Beads issue:** orrery-c6y (claim before starting: `bd update orrery-c6y --claim`).

---

## Acceptance Criteria Coverage

This phase implements and verifies:

### render-layers.AC6: Per-file expand gesture (deliverable 2)
- **render-layers.AC6.1 Success:** The distinct gesture (double-click) on a file toggles just that file's classes; single-click still drills/focuses (unchanged).
- **render-layers.AC6.2 Success:** Searching or drilling to a class in a collapsed file auto-expands that file so the class renders.
- **render-layers.AC6.3 Edge:** The gesture on a file with no classes is a no-op (no error).

All three are interaction criteria — human-verified per the test plan. The underlying per-file `expanded` transform (single module in the set) is already covered by Phase 1 unit tests (AC1.2, AC2.2).

---

<!-- START_TASK_1 -->
### Task 1: Double-click gesture + auto-expand in `template.html`

**Verifies:** render-layers.AC6.1, AC6.2, AC6.3 (human-verified; this task builds the behavior)

**Files:**
- Modify: `src/render/template.html` (gesture, `drillTo`, hover cursor, crumb hint)

**Step 1: Per-file toggle**

Next to the `collapse-all`/`expand-all` handlers added in Phase 2, add:

```javascript
// Toggle a single file's classes. Files without classes have nothing to
// open — the gesture is a no-op for them.
function toggleFile(moduleId) {
  if (!classCount.get(moduleId)) return;
  if (expanded.has(moduleId)) expanded.delete(moduleId); else expanded.add(moduleId);
  applyZoom();
}
```

(`classCount` is the `Map<moduleId, number>` built in Phase 2.)

**Step 2: Click-timing double-click (Phase 2's `.onNodeClick(node => drillTo(node.id))` line)**

Replace the handler with a closure that keeps single-click instantaneous:

```javascript
  // No native dblclick in 3d-force-graph: first click drills exactly as
  // before (single-click behavior unchanged, zero delay); a second click on
  // the same node inside the window is the expand/collapse gesture.
  .onNodeClick((() => {
    let last = { id: null, t: 0 };
    return node => {
      const now = Date.now();
      const dbl = node.id === last.id && now - last.t < 400;
      last = { id: node.id, t: now };
      if (dbl && node.kind === 'module') { toggleFile(node.id); return; }
      drillTo(node.id);
    };
  })())
```

Note the no-classes case (AC6.3): `toggleFile` returns without touching state, so a double-click on an empty file leaves the (already drilled-to) view exactly as the first click left it — no error, no change.

**Step 3: Auto-expand in `drillTo` (line 277-281)**

Replace:

```javascript
function drillTo(id) {
  if (focus !== id) { history.push(focus); focus = id; }
  applyFocus();
  flyToNode(id);
}
```

with:

```javascript
function drillTo(id) {
  const n = nodeById.get(id);
  // A class inside a collapsed file isn't on the frontier — open its file
  // first so the target exists in the scene before we focus and fly to it.
  if (n && n.kind === 'class' && !expanded.has(n.module)) {
    expanded.add(n.module);
    applyZoom();
  }
  if (focus !== id) { history.push(focus); focus = id; }
  applyFocus();
  flyToNode(id);
}
```

This covers every navigation path in one place: search (line 377-383), detail-panel `classes here` clicks (line 336-337), and "start here" chips — all route through `drillTo`. `flyToNode` works immediately because Phase 2's `graphNode()` seeds new class nodes at their file's coordinates.

**Step 4: Cursor affordance on expandable files**

In the `Graph` construction chain, add:

```javascript
  .onNodeHover(n => {
    document.getElementById('graph').style.cursor =
      n && n.kind === 'module' && classCount.get(n.id) ? 'pointer' : null;
  })
```

**Step 5: Update the interaction hint**

The crumb hint (HTML line 63 and the string in `updateCrumb`, line 295-296) says "click a node to drill in". Append "· double-click a file to open it" to both occurrences.

**Step 6: Verify**

Run: `bun test`
Expected: all pass (no engine changes; guards against accidental regressions).

Run: `bun run orrery build tests/fixtures/repo --out /tmp/orrery-render-layers/fixture.html`
Expected: builds cleanly.

**Step 7: Commit**

```bash
git add src/render/template.html
git commit -m "feat(render): per-file double-click expand + auto-expand-on-select (orrery-c6y)"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Human verification + close out

**Verifies:** render-layers.AC6.1, AC6.2, AC6.3 (human)

**Step 1: Open the fixture map**

```bash
bun run orrery build tests/fixtures/repo --out /tmp/orrery-render-layers/fixture.html --open
```

Checklist (also captured in `test-requirements.md`):
1. From the collapsed default, double-click a file with classes (e.g. `base` under `repo.web`): only that file's classes appear, fanned around it; double-click again closes it. Other files stay closed. (AC6.1)
2. Single-click on any node still drills/focuses exactly as before (first click of a double-click included). (AC6.1)
3. With everything collapsed, search for a class (e.g. `Circle`, Enter): its file auto-expands and the view flies to the class. Same when clicking a class in a module's `classes here` detail list. (AC6.2)
4. Double-click a file with no classes (e.g. a helper module such as `repo.pkg.helpers` if class-free — pick any module dot that stays childless under `expand all`): nothing changes, no console errors. (AC6.3)
5. Mixed state caption reads "zoom: mixed (N files open)"; `collapse all` / `expand all` still override wholesale.

**Step 2: Update trackers and finish the branch**

```bash
bd close orrery-c6y --reason="Per-file gesture + auto-expand verified (AC6.*)"
bd close orrery-7ni --reason="All render-layers phases complete"
bd update orrery-d0a --status=closed --reason="Containment zoom shipped: engine, global control, per-file gesture"
deciduous add outcome "Phase 3 complete: render-layers feature done" -c 90 --commit HEAD
```

Then follow the session-close protocol (quality gates, `git pull --rebase && git push`, verify clean status).
<!-- END_TASK_2 -->
