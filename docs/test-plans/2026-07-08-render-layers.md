# Human Test Plan — Renderer Containment Zoom (render-layers)

Generated from `docs/implementation-plans/2026-07-08-render-layers/test-requirements.md` after the final review pass (HEAD `bf1a1ac`). Automated coverage: 12/12 automatable acceptance criteria verified by `tests/layers.test.ts` and `tests/render.test.ts` (21 tests). The criteria below are the designated human-verified interaction/visual checks.

## Prerequisites

- Repo at HEAD `bf1a1ac` or later; `bun` installed.
- `bun test` passing.
- Build the fixture scene:
  ```bash
  bun run orrery build tests/fixtures/repo --out /tmp/orrery-render-layers/fixture.html --open
  ```
- Fixture expected shape: 3 packages, 13 modules, 12 classes, 8 `import` edges, 9 `uses` edges.
- Open browser DevTools (Console + Network tabs) before loading.

## Phase 2: Global zoom control & output

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Load the page; observe initial scene and caption. | Only package + module dots visible, **zero class nodes**. `import` edges thin blue-grey; lifted `uses` edges darker orange (`#b5701f`) and thicker (1.8 vs 1.2), visually distinct from `import`. Caption reads **"zoom: files (collapsed)"**. (AC3.1, AC5.2) |
| 2.2 | Click **▤ expand all**. | All **12** class nodes appear, each tethered to its file by a faint `contains` link (no arrow). Class→class `uses` edges show bright orange. Caption reads **"zoom: classes (all files expanded)"**. (AC3.2) |
| 2.3 | Click **▣ collapse all**. | Scene returns exactly to the step 2.1 state (zero classes, collapsed caption). (AC3.2) |
| 2.4 | Toggle each edge-kind control (`import`, `uses`, `registers`) off then on. | Edges of that kind hide/show accordingly; caption unchanged. (AC3.3) |
| 2.5 | Toggle the cycles control; toggle labels. | Scene repaints without relayout; labels appear/disappear. (AC3.3) |
| 2.6 | Type a module name in search, press Enter. | View drills/flies to that module. (AC3.3) |
| 2.7 | DevTools → Network, reload the `file://` page, watch for requests after load. | **No external asset requests** — fully self-contained/offline. (AC5.1 no-external component) |
| 2.8 | DevTools → Console throughout steps 2.1–2.7. | Zero errors. |

## Phase 3: Per-file expand gesture

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | From collapsed default, double-click a file that has classes (e.g. `base` under the `web` package) within ~400ms. | Only that file's classes fan out around it; all other files stay closed. Caption switches to **"zoom: mixed (1 file open)"**. (AC6.1) |
| 3.2 | Double-click the same file again. | That file closes; its classes disappear; caption returns toward collapsed/mixed accordingly. (AC6.1) |
| 3.3 | Single-click any node (including the first click of a double-click). | It drills/focuses immediately with zero delay — behavior unchanged from before the feature. (AC6.1) |
| 3.4 | With everything collapsed, search for a class (e.g. `Circle`), press Enter. | The class's containing file auto-expands and the camera flies to the class. (AC6.2) |
| 3.5 | Drill into a module, open its detail panel, click a class under "classes here". | That class's file auto-expands and the view focuses the class. (AC6.2) |
| 3.6 | Double-click a module dot that has no classes (a helper module that stays childless under expand-all). | Nothing changes; no console error. (AC6.3) |
| 3.7 | Enter a mixed state (one file open), then click **collapse all**, then **expand all**. | Caption reads "zoom: mixed (N files open)" while mixed; global buttons override per-file state wholesale. (Sanity for AC3.3/AC6.1) |

## End-to-End: Collapsed browse → drill → per-file open → global reset

Purpose: validates the full zoom-control lifecycle spanning Phase 2 and Phase 3 wiring against real fixture data.

1. Load collapsed (2.1) → confirm files-only view and lifted `uses` styling.
2. Double-click a `web` file with classes (3.1) → its classes fan out; caption "mixed (1 file open)".
3. Single-click one of the revealed classes (3.3) → drills/focuses, detail panel shows its `uses`/`registers` lists.
4. Search a class in a still-collapsed file (3.4) → its file auto-expands, camera flies in; caption now "mixed (2 files open)".
5. Click **collapse all** → returns to exact step 1 state (3.7).
6. Throughout: Network shows no external requests (2.7); Console shows zero errors.

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC3.1 | Visual collapsed default / edge rendering — no browser harness. | 2.1 |
| AC3.2 | Interactive expand-all/collapse-all DOM buttons. | 2.2, 2.3 |
| AC3.3 | Legend caption + pre-existing DOM controls (toggles, cycles, focus/drill, search). | 2.1–2.6 |
| AC5.1 (no-external) | Network-level offline check requires DevTools. | 2.7 |
| AC5.2 | Visual distinctness of lifted `uses` vs `import`. | 2.1 |
| AC6.1 | Double-click vs single-click gesture timing in the live scene. | 3.1–3.3 |
| AC6.2 | Auto-expand-on-select via search and detail-list interaction. | 3.4, 3.5 |
| AC6.3 | No-op gesture on class-free file (visual + console). | 3.6 |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `tests/layers.test.ts:48` | — |
| AC1.2 | `tests/layers.test.ts:58` | (indirectly exercised by 3.1) |
| AC1.3 | `tests/layers.test.ts:76` | (indirectly by 2.2) |
| AC1.4 | `tests/layers.test.ts:84` | (indirectly by 3.6) |
| AC1.5 | `tests/layers.test.ts:90` | — |
| AC2.1 | `tests/layers.test.ts:102` | (visual in 2.1) |
| AC2.2 | `tests/layers.test.ts:118` | (visual in 3.1) |
| AC2.3 | `tests/layers.test.ts:134` | (visual in 2.2) |
| AC2.4 | `tests/layers.test.ts:146` | — |
| AC4.1 | `tests/layers.test.ts:160,171,179` | — |
| AC4.2 | `tests/layers.test.ts:188,198` | — |
| AC3.1 | — | 2.1 |
| AC3.2 | — | 2.2, 2.3 |
| AC3.3 | — | 2.1–2.6, 3.7 |
| AC5.1 (injection) | `tests/render.test.ts:18` | — |
| AC5.1 (no-external) | — | 2.7 |
| AC5.2 | — | 2.1 |
| AC6.1 | — | 3.1–3.3 |
| AC6.2 | — | 3.4, 3.5 |
| AC6.3 | — | 3.6 |

## Note on automated smoke coverage

During execution, headless-Chromium smoke scripts (session scratchpad, not committed) additionally exercised the human-designated criteria as a proxy: collapsed default (caption, zero classes, lifted `uses` edges), expand-all/collapse-all (12 classes, `contains` links), single-file `toggleFile` open/close + mixed caption, a real canvas double-click expand, `drillTo` auto-expand of a collapsed class's file, empty-module toggle no-op, zero console/page errors, and zero external network requests — all passing. The visual checks above (colors, widths, camera behavior, gesture feel) still need human eyes.
