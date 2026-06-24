# `uses` Edges — Phase 5: Integration verification

**Goal:** Confirm the feature works end-to-end at scale and through the renderer: `uses` edges flow into a valid self-contained HTML, participate in PageRank, and never fabricate import cycles.

**Scope:** Phase 5 of 5. Depends on Phases 2–4.

**Codebase verified:** 2026-06-24.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### uses-edges.AC6: uses edges participate in centrality
- **uses-edges.AC6.1 Success:** `uses` edges feed PageRank (a node depended on only via `uses` edges receives centrality from them).
- **uses-edges.AC6.2 Failure:** `uses` edges do **not** create import-cycle (`cycle`) annotations — SCC detection stays import-only.

### uses-edges.AC7: No regressions; valid output
- **uses-edges.AC7.1 Success:** The full `bun test` suite passes.
- **uses-edges.AC7.2 Success:** `bun run orrery build <repo>` still produces a valid self-contained HTML file containing `uses` edges.

> Build targets are **non-proprietary** repos only: the test fixture repo
> (`tests/fixtures/repo`) and the orrery repo itself. Do **not** use any
> proprietary repo as a committed/verified build target.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Test that `uses` edges feed centrality but not cycles

**Verifies:** uses-edges.AC6.1, uses-edges.AC6.2

**Files:**
- Modify: `tests/analyze.test.ts`

**Step 1: Understand the current behavior (already verified)**

In `src/graph/analyze.ts::augment` (lines 106–129):
- PageRank consumes **all** edges: `pagerank(graphIds, map.edges.map((e) => [e.source, e.target]))` (line 108) — no kind filter, so `uses` edges already contribute.
- SCC/cycle uses **only** import edges: `map.edges.filter((e) => e.kind === "import")` (line 117) — so `uses` edges cannot create a `cycle`.

This phase **locks that behavior in with tests** (no code change to `analyze.ts`).

**Step 2: Add tests**

`tests/analyze.test.ts` already imports `{ pagerank, sccs, augment }` and uses `bun:test`. Add:

```typescript
test("uses edges feed PageRank centrality (AC6.1)", () => {
  // 'lib:Helper' is depended on ONLY via a uses edge; it must still get a score.
  const map = {
    root: "repo",
    nodes: [
      { id: "app:App", kind: "class" as const },
      { id: "lib:Helper", kind: "class" as const },
    ],
    edges: [{ source: "app:App", target: "lib:Helper", kind: "uses" as const }],
  };
  augment(map);
  const helper = map.nodes.find((n) => n.id === "lib:Helper")!;
  expect(helper.score).toBeGreaterThan(0);
});

test("uses edges do not create cycle annotations (AC6.2)", () => {
  // A mutual uses relationship would be a cycle IF uses fed SCC — it must not.
  const map = {
    root: "repo",
    nodes: [
      { id: "a:A", kind: "class" as const },
      { id: "b:B", kind: "class" as const },
    ],
    edges: [
      { source: "a:A", target: "b:B", kind: "uses" as const },
      { source: "b:B", target: "a:A", kind: "uses" as const },
    ],
  };
  augment(map);
  expect(map.nodes.every((n) => n.cycle === undefined)).toBe(true);
});
```

> If TypeScript objects to the inline literals, mirror the shape used by the
> existing `augment` test in this file (it already constructs a `CodeMap`-like
> literal). Import `type { CodeMap }` from `../src/schema.ts` and annotate if
> needed.

**Step 3: Run**

Run: `bun test`
Expected: **12 pass, 1 skip, 0 fail** — Phase 4's 10 passing + these 2 new
analyze tests = 12; the env-gated differential test remains skipped.

**Step 4: Commit**

```bash
git add tests/analyze.test.ts
git commit -m "test(graph): lock in uses-edge centrality, no false cycles (orrery-xq6)

uses edges feed PageRank; SCC/cycle stays import-only. No analyze.ts change.

Refs: orrery-2uv, orrery-toj"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Verify the full build emits `uses` edges in valid HTML

**Verifies:** uses-edges.AC7.1, uses-edges.AC7.2

**Files:**
- None modified (operational verification). Optionally create a scratch output
  outside the repo; do not commit generated HTML.

**Step 1: Full suite green**

Run: `bun test`
Expected: **12 pass, 1 skip, 0 fail** (differential skipped). This is AC7.1.

**Step 2: Build the fixture repo and confirm `uses` edges are embedded**

`src/render/index.ts` embeds the `CodeMap` into the HTML via
`JSON.stringify(map)` (no spaces) after the `/*{{DATA}}*/` marker — confirmed in
the renderer — so edges appear literally as `{"source":...,"target":...,"kind":"uses"}`.
Build the fixture repo to a scratch path and grep the output:

```bash
bun run orrery build tests/fixtures/repo --out /tmp/orrery-fixture.html
grep -c '"kind":"uses"' /tmp/orrery-fixture.html
```
Expected: the CLI prints its `packages / modules / edges` summary line, and the
grep count is **≥ 1** (the fixture now contains Python + TS + JS `uses` edges).

**Step 3: Build the orrery repo itself (a real, larger, non-proprietary repo)**

```bash
bun run orrery build . --out /tmp/orrery-self.html
grep -c '"kind":"uses"' /tmp/orrery-self.html
```
Expected: a valid HTML file is produced and the grep count is **≥ 1** (orrery's
own TS classes reference each other). This satisfies AC7.2 on a real codebase.

**Step 4: Sanity-check the HTML is self-contained and well-formed**

```bash
test -s /tmp/orrery-self.html && head -c 200 /tmp/orrery-self.html
```
Expected: non-empty file beginning with `<!DOCTYPE html>` (or the renderer's
header). No external asset references are required for the map to load.

**Step 5: Clean up scratch output (do not commit)**

```bash
rm -f /tmp/orrery-fixture.html /tmp/orrery-self.html
```

No commit (no source changes in this task).
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

---

## Phase 5 Done When

- New `tests/analyze.test.ts` tests prove `uses` edges feed PageRank (AC6.1) and never create `cycle` annotations (AC6.2).
- `bun test` passes fully (AC7.1), differential test skipped.
- `bun run orrery build` on both `tests/fixtures/repo` and `.` (orrery itself) yields valid self-contained HTML containing `uses` edges (AC7.2).
- Only non-proprietary repos used as build targets.
- All work committed.

---

## Feature complete

With Phases 1–5 done, orrery emits `uses` edges as a per-language plugin
capability for Python, TypeScript, TSX, and JavaScript; the engine is
language-agnostic (zero core changes to add a language); `uses` edges feed
centrality and render through the existing toggle; and Python parity is gated by
an env-driven differential against a reference prototype with a documented
allowlist. Close beads `orrery-toj` (epic) and `orrery-2uv` (feature) once
verification passes.
