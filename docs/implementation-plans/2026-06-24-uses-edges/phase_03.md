# `uses` Edges — Phase 3: Python differential gate

**Goal:** Prove Python `uses`-edge parity against a validated external reference prototype on a real repo — without committing any proprietary code, repo, or name.

**Scope:** Phase 3 of 5. Depends on Phase 2. Independent of Phase 4.

**Codebase verified:** 2026-06-24.

---

> ⚠️ **Proprietary constraint (do not violate).** The reference prototype and the
> repo it runs on are **proprietary and non-public**. **No proprietary file, path,
> or name may be committed.** Use only the generic terms "reference prototype" and
> "reference repo" in committed code, comments, and docs. The test reads both
> locations from **environment variables** and **skips** when they are unset, so
> CI stays green and nothing proprietary ever enters the repo.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### uses-edges.AC5: Python parity vs the prototype
- **uses-edges.AC5.1 Success:** On the reference repo, orrery's `uses` edge set equals the prototype's, modulo a documented allowlist of acceptable diffs.
- **uses-edges.AC5.2 Success:** Every accepted diff has a written cause (e.g. the load-vs-store approximation).

---

## Contract between the two extractors

The reference prototype must emit, on stdout, a JSON array of `uses` edges as
`{"source": "<id>", "target": "<id>"}` objects using the **same node-id
convention** orrery uses (`repo.pkg.mod` for modules, `repo.pkg.mod:Class` for
classes, where `repo` is the basename of the repo path). If the prototype's raw
output differs, the harness normalizes it (see Task 2, Step 2).

Two environment variables drive the test:
- `ORRERY_DIFF_PROTOTYPE` — absolute path to the prototype entry script (run as `python <path> <repo>`).
- `ORRERY_DIFF_REPO` — absolute path to the reference repo to extract.

Optional:
- `ORRERY_DIFF_PYTHON` — python interpreter (default `python3`).
- `ORRERY_DIFF_ALLOWLIST` — path to an allowlist JSON (default: the committed `tests/diff-allowlist.json`).

When `ORRERY_DIFF_PROTOTYPE` or `ORRERY_DIFF_REPO` is unset, the test **skips**.

---

<!-- START_TASK_1 -->
### Task 1: Commit an empty, documented diff allowlist

**Files:**
- Create: `tests/diff-allowlist.json`

**Step 1: Create the allowlist**

The allowlist enumerates `uses` edges that may differ between orrery and the
prototype, each with a written cause (AC5.2). It ships **empty** (no accepted
diffs yet); entries are added only when the differential run surfaces a genuine,
explained approximation.

```json
{
  "comment": "Accepted uses-edge differences between orrery and the reference Python prototype. Each entry MUST state a cause. 'onlyOrrery' = edges orrery emits that the prototype does not; 'onlyPrototype' = the reverse. Edge form: 'source->target'.",
  "onlyOrrery": [],
  "onlyPrototype": []
}
```

> Entry shape when needed (example, do not commit unless real):
> `{ "edge": "repo.pkg.a:A->repo.pkg.b", "cause": "load-vs-store approximation: tree-sitter cannot tell a read from an assignment, so orrery over-emits here." }`
> — i.e. each array holds objects `{ edge, cause }`.

**Step 2: Commit**

```bash
git add tests/diff-allowlist.json
git commit -m "test(extract): add empty uses-edge differential allowlist (orrery-aoz)

Refs: orrery-2uv, orrery-toj"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Write the env-gated differential test

**Verifies:** uses-edges.AC5.1, uses-edges.AC5.2

**Files:**
- Create: `tests/diff.test.ts`

**Step 1: Implement the harness**

Use `test.skipIf` (bun:test) so the test no-ops when the env vars are absent.
Run the prototype via `Bun.spawn`, run orrery's `extract`, and compare `uses`
edge sets after subtracting allowlisted diffs.

```typescript
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extract } from "../src/extract/index.ts";

const PROTOTYPE = process.env.ORRERY_DIFF_PROTOTYPE;
const REPO = process.env.ORRERY_DIFF_REPO;
const PYTHON = process.env.ORRERY_DIFF_PYTHON ?? "python3";
const ALLOWLIST_PATH =
  process.env.ORRERY_DIFF_ALLOWLIST ?? join(import.meta.dir, "diff-allowlist.json");

const enabled = Boolean(PROTOTYPE && REPO);

interface Allow {
  onlyOrrery: { edge: string; cause: string }[];
  onlyPrototype: { edge: string; cause: string }[];
}

async function prototypeUsesEdges(): Promise<Set<string>> {
  const proc = Bun.spawn([PYTHON, PROTOTYPE!, REPO!], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`reference prototype exited ${code}: ${err}`);
  }
  // Expected: JSON array of { source, target } uses edges using orrery id conventions.
  const parsed = JSON.parse(out) as { source: string; target: string }[];
  return new Set(parsed.map((e) => `${e.source}->${e.target}`));
}

test.skipIf(!enabled)("python uses edges match the reference prototype (AC5)", async () => {
  const allow = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as Allow;
  const allowOnlyOrrery = new Set(allow.onlyOrrery.map((a) => a.edge));
  const allowOnlyPrototype = new Set(allow.onlyPrototype.map((a) => a.edge));
  // AC5.2: every allowlist entry must carry a non-empty cause.
  for (const a of [...allow.onlyOrrery, ...allow.onlyPrototype]) {
    expect(a.cause.trim().length).toBeGreaterThan(0);
  }

  const map = await extract(REPO!);
  const orrery = new Set(
    map.edges.filter((e) => e.kind === "uses").map((e) => `${e.source}->${e.target}`),
  );
  const proto = await prototypeUsesEdges();

  const onlyOrrery = [...orrery].filter((e) => !proto.has(e) && !allowOnlyOrrery.has(e));
  const onlyPrototype = [...proto].filter((e) => !orrery.has(e) && !allowOnlyPrototype.has(e));

  // AC5.1: set-equality modulo the documented allowlist.
  expect({ onlyOrrery, onlyPrototype }).toEqual({ onlyOrrery: [], onlyPrototype: [] });
});

test("diff allowlist entries all carry a cause", () => {
  const allow = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as Allow;
  for (const a of [...allow.onlyOrrery, ...allow.onlyPrototype]) {
    expect(typeof a.cause).toBe("string");
    expect(a.cause.trim().length).toBeGreaterThan(0);
  }
});
```

> The second test runs **always** (even when the differential is skipped) so the
> committed allowlist can never contain a causeless entry (guards AC5.2).

**Step 2: If the prototype output shape differs**

If the reference prototype cannot emit the exact `{source,target}` JSON above,
add a small normalization step **inside `prototypeUsesEdges`** (e.g. map the
prototype's own id format to orrery's `repo.pkg.mod[:Class]` convention). Keep
all proprietary specifics out of the committed file — normalization logic is
generic; it must not hardcode proprietary module names.

**Step 3: Verify the test is green/skipped both ways**

Skipped path (default, no env):
Run: `bun test`
Expected: previous tests pass; the differential test shows **skipped**; the
allowlist-cause test passes. (Phase 2 left 7 passing; now 8 with 1 skipped — e.g.
`8 pass, 1 skip` or similar depending on counting.)

Enabled path (only if you have the proprietary artifacts locally):
```bash
ORRERY_DIFF_PROTOTYPE=/abs/path/to/prototype.py \
ORRERY_DIFF_REPO=/abs/path/to/reference-repo \
bun test tests/diff.test.ts
```
Expected: the differential test runs. If it fails with real, explainable diffs,
add `{ edge, cause }` entries to `tests/diff-allowlist.json` (cause required) and
re-run until green. Do **not** weaken the assertion to pass.

**Step 4: Commit**

```bash
git add tests/diff.test.ts
git commit -m "test(extract): env-gated python uses-edge differential gate (orrery-aoz)

Compares orrery uses edges to a reference prototype's, modulo a documented
allowlist. Skips when ORRERY_DIFF_PROTOTYPE/ORRERY_DIFF_REPO are unset so no
proprietary artifact is required or committed.

Refs: orrery-2uv, orrery-toj"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Document the differential gate (generic, no proprietary names)

**Files:**
- Create: `docs/uses-edges-differential.md`

**Step 1: Write the doc**

Explain how to run the gate and how the allowlist works. Keep it fully generic.

```markdown
# Python `uses`-edge differential gate

`tests/diff.test.ts` checks that orrery's Python `uses` edges match a validated
external **reference prototype** on a **reference repo**. Both are supplied at
run time via environment variables and are **never committed** (they may be
proprietary):

- `ORRERY_DIFF_PROTOTYPE` — path to the prototype script, run as `python <path> <repo>`.
  It must print a JSON array of `{ "source", "target" }` `uses` edges using
  orrery's id convention (`repo.pkg.mod`, `repo.pkg.mod:Class`).
- `ORRERY_DIFF_REPO` — path to the repo to extract.
- `ORRERY_DIFF_PYTHON` — interpreter (default `python3`).
- `ORRERY_DIFF_ALLOWLIST` — allowlist path (default `tests/diff-allowlist.json`).

When the prototype/repo vars are unset, the differential test **skips**.

## Run

    ORRERY_DIFF_PROTOTYPE=/abs/prototype.py \
    ORRERY_DIFF_REPO=/abs/reference-repo \
    bun test tests/diff.test.ts

## Allowlist

`tests/diff-allowlist.json` records edges that may legitimately differ between
the two extractors, each with a written **cause**. The most common cause is the
**load-vs-store approximation**: tree-sitter queries cannot distinguish a name
being read from one being assigned, so orrery may over-emit relative to an
AST-based prototype. Every entry requires a non-empty `cause`; a committed
causeless entry fails the test suite.
```

**Step 2: Commit**

```bash
git add docs/uses-edges-differential.md
git commit -m "docs(extract): document env-gated uses-edge differential gate (orrery-aoz)

Refs: orrery-2uv, orrery-toj"
```
<!-- END_TASK_3 -->

---

## Phase 3 Done When

- `tests/diff.test.ts` exists and **skips cleanly** with no env vars set; `bun test` stays green.
- `tests/diff-allowlist.json` exists (empty arrays) and is guarded so every entry needs a cause.
- `docs/uses-edges-differential.md` documents the gate generically.
- **No proprietary name, path, or source is committed anywhere.**
- All work committed.

> **Note on AC5 satisfaction.** Because the prototype and repo are proprietary and
> supplied only via env vars, AC5.1/AC5.2 are *fully exercised* only when a
> developer runs the gate locally with `ORRERY_DIFF_PROTOTYPE`/`ORRERY_DIFF_REPO`
> set. In CI (and by default) the differential test **skips**; the always-on
> allowlist-cause test still guards AC5.2. Record the result of at least one local
> run (pass, or the allowlist entries added) in beads `orrery-aoz` before closing
> it.
