# `uses` Edges — Test Requirements (AC → Verification Map)

Traceability matrix mapping every acceptance criterion from the design
(`docs/design-plans/2026-06-23-uses-edges.md`, AC1.1–AC8.2) to a concrete
verification: an automated test (with file path + assertion) or documented
human verification.

**Test runner:** `bun test` (framework `bun:test`; top-level `test()`;
`.toBe` / `.toEqual` / `.toBeGreaterThan`).

**Test files referenced:**
- `tests/extract.test.ts` — extractor: structure, import edges, and new `uses` edges (Python, TS, JS).
- `tests/analyze.test.ts` — PageRank / SCCs / `augment`.
- `tests/diff.test.ts` — env-gated Python differential vs the reference prototype (SKIPS when env vars unset).

**Fixtures:** `tests/fixtures/repo/{pkg/*.py, web/*.ts, web/*.js}`.

**Conventions:** node ids — module `repo.pkg.base`, class `repo.pkg.base:Base`
(`${moduleId}:${ClassName}`). Edge shape `{source, target, kind}`, kind ∈
`import | uses | registers | calls`.

**Test types:** `unit` = isolated extractor/analyzer assertion on fixtures or
in-memory maps; `integration` = end-to-end build through the renderer;
`human-verification` = requires a local/manual run (proprietary differential, or
build producing a valid HTML artifact).

---

## AC1 — Per-module symbol table maps local names to node ids

| AC id | Criterion text | Type | Test file | Assertion |
|-------|----------------|------|-----------|-----------|
| uses-edges.AC1.1 | Success: a plain import (`import a.b`) binds the local name to the resolved module node id. | unit | `tests/extract.test.ts` | Exercised transitively: `service.py` uses `from . import helpers`; `Service` referencing `helpers` resolves through the table to module `repo.pkg.helpers` — asserts `u.has("repo.pkg.service:Service->repo.pkg.helpers")`. Plain dotted-import binding is the path that makes this resolve. |
| uses-edges.AC1.2 | Success: an aliased import (`import a.b as c` / `import {x as y}`) binds the alias to the target node id. | unit | `tests/extract.test.ts` | Python: `aliased.py` (`from .base import Base as B`, `class Child(B)`) asserts `u.has("repo.pkg.aliased:Child->repo.pkg.base:Base")`. TS: `web/aliased.ts` (`Base as B`) asserts `u.has("repo.web.aliased:Aliased->repo.web.base:Base")`. |
| uses-edges.AC1.3 | Success: a `from`-style class import (`from .base import Base`) binds the local name to the class node id (`module:Base`), not the module. | unit | `tests/extract.test.ts` | Python: `impl.py` / `service.py` extending imported `Base` assert `u.has("repo.pkg.impl:Impl->repo.pkg.base:Base")` and `u.has("repo.pkg.service:Service->repo.pkg.base:Base")` (target is the class id, proving class-preference over module). |
| uses-edges.AC1.4 | Success: a same-module top-level class is present in the table mapped to its own class node id. | unit | `tests/extract.test.ts` | `service.py` `Worker` references same-module `Service`; asserts `u.has("repo.pkg.service:Worker->repo.pkg.service:Service")` — only possible if the same-module class is in the table. |
| uses-edges.AC1.5 | Failure: an external/stdlib import (`import os`, bare specifier) resolves to null and adds no table entry. | unit | `tests/extract.test.ts` | `service.py` imports `os`; asserts `[...u].some((s) => s.includes("os")) === false` (no `uses` edge to/through any `os` target). |

## AC2 — Class references resolve into uses edges

| AC id | Criterion text | Type | Test file | Assertion |
|-------|----------------|------|-----------|-----------|
| uses-edges.AC2.1 | Success (class→class): a class extending/subclassing an imported class emits a `uses` edge to that class node. | unit | `tests/extract.test.ts` | Python: `u.has("repo.pkg.impl:Impl->repo.pkg.base:Base")` and `u.has("repo.pkg.service:Service->repo.pkg.base:Base")`. TS: `u.has("repo.web.child:Child->repo.web.base:Base")`. JS: `u.has("repo.web.circle:Circle->repo.web.shape:Shape")`. |
| uses-edges.AC2.2 | Success (class→module fallback): a class referencing an imported module-level function/constant emits a `uses` edge to the module node. | unit | `tests/extract.test.ts` | Python: `u.has("repo.pkg.service:Service->repo.pkg.helpers")` (`helpers.helper()` → module). TS: `u.has("repo.web.bar:Bar->repo.web.foo")` (`Bar` calls imported function `foo` → module). |
| uses-edges.AC2.3 | Success (same-module): a class referencing another top-level class in its own module emits a `uses` edge to that class node. | unit | `tests/extract.test.ts` | `u.has("repo.pkg.service:Worker->repo.pkg.service:Service")`. |
| uses-edges.AC2.4 | Edge: the attribute/member chain root is the referenced name (`a.b.c` ⇒ `a`); property names do not produce edges. | unit | `tests/extract.test.ts` | Python (`@skip` subtraction): `helpers.helper()` yields only `Service->repo.pkg.helpers` (root `helpers`), no edge from the `helper`/`helper()` property names. TS: `Bar->repo.web.foo` from `foo(...)` member root; `property_identifier` nodes are never captured as `@ref`. |
| uses-edges.AC2.5 | Edge: duplicate references within one class produce a single deduped edge. | unit | `tests/extract.test.ts` | "exclusions and dedup" test: `list.length === new Set(list).size` over all `uses` edges (one edge per `(source,target)`), backed by the engine's `${owner}|${target}|uses` `edgeSeen` key. |

## AC3 — Exclusions match the prototype

| AC id | Criterion text | Type | Test file | Assertion |
|-------|----------------|------|-----------|-----------|
| uses-edges.AC3.1 | Failure (self): a class referencing its own name emits no `uses` edge. | unit | `tests/extract.test.ts` | `solo.py` `Solo` references `Solo`; asserts `u.has("repo.pkg.solo:Solo->repo.pkg.solo:Solo") === false`. |
| uses-edges.AC3.2 | Failure (own-module): a reference resolving only to the class's own module emits no `uses` edge. | unit | `tests/extract.test.ts` | Asserts `u.has("repo.pkg.service:Service->repo.pkg.service") === false` (own-module guard `target === file.id`). Additionally exercised in depth by the Phase 3 differential (`tests/diff.test.ts`) — see AC5. |
| uses-edges.AC3.3 | Failure (unresolved): a reference with no symbol-table entry (local variable, parameter, external name) emits no edge. | unit | `tests/extract.test.ts` | `solo.py`/`service.py`: asserts no edges through `util` (same-module function, not in table) or `self` (param): `[...u].some((s) => s.includes("util")) === false` and `... includes("self") === false`. |

## AC4 — Pluggable: adding a language requires zero core changes

| AC id | Criterion text | Type | Test file | Assertion |
|-------|----------------|------|-----------|-----------|
| uses-edges.AC4.1 | Success: implementing `UsesCapability` on TS/TSX/JS produces `uses` edges with no edit to `src/extract/index.ts` or `src/graph/analyze.ts`. | unit + human-verification | `tests/extract.test.ts` (TS/JS `uses` edges present); `git diff` (no core change) | The TS/JS `uses` assertions passing proves the capability works through the unchanged engine. The zero-core-change half is verified by a manual check: `git diff --name-only HEAD~ -- src/extract/index.ts src/graph/analyze.ts` must be empty for the Phase 4 commit(s). This `git diff` is a one-time review-gate, not an automated test — documented as human-verification. |
| uses-edges.AC4.2 | Success: a plugin without a `uses` field emits no `uses` edges and does not error. | unit | `tests/extract.test.ts` | Implicitly satisfied throughout: structure-only languages (no plugin `uses`) cause pass 2 to skip without error; the full suite running green over a mixed-language fixture repo (and Phase 2's "engine inert without capability" green run) demonstrates no error and no spurious edges. |

## AC5 — Python parity vs the prototype (proprietary, env-gated)

| AC id | Criterion text | Type | Test file | Assertion |
|-------|----------------|------|-----------|-----------|
| uses-edges.AC5.1 | Success: on the reference repo, orrery's `uses` edge set equals the reference prototype's, modulo a documented allowlist. | human-verification (env-gated automated) | `tests/diff.test.ts` | `test.skipIf(!enabled)("...match the reference prototype (AC5)")` runs the reference prototype via `Bun.spawn`, runs orrery's `extract`, and asserts `{ onlyOrrery, onlyPrototype }` toEqual `{ [], [] }` after subtracting the allowlist. SKIPS unless `ORRERY_DIFF_PROTOTYPE` and `ORRERY_DIFF_REPO` are set. The prototype and repo are proprietary and never committed, so this AC is fully exercised only by a local run — hence human-verification. Record the result of at least one local run in beads `orrery-aoz`. |
| uses-edges.AC5.2 | Success: every accepted diff has a written cause. | unit (always-on) + human-verification | `tests/diff.test.ts`, `tests/diff-allowlist.json` | Always-on test "diff allowlist entries all carry a cause" asserts every `onlyOrrery`/`onlyPrototype` entry has `typeof cause === "string"` and `cause.trim().length > 0` — runs even when the differential is skipped, so a causeless committed entry fails the suite. The substance (that real diffs are genuinely explained) is confirmed during the human-verification local run. |

## AC6 — uses edges participate in centrality

| AC id | Criterion text | Type | Test file | Assertion |
|-------|----------------|------|-----------|-----------|
| uses-edges.AC6.1 | Success: `uses` edges feed PageRank (a node depended on only via `uses` edges receives centrality). | unit | `tests/analyze.test.ts` | "uses edges feed PageRank centrality (AC6.1)": in-memory map where `lib:Helper` is reached only by a `uses` edge; after `augment(map)`, asserts `helper.score` `toBeGreaterThan(0)`. |
| uses-edges.AC6.2 | Failure: `uses` edges do not create import-cycle (`cycle`) annotations — SCC stays import-only. | unit | `tests/analyze.test.ts` | "uses edges do not create cycle annotations (AC6.2)": mutual `A↔B` via `uses` edges; after `augment(map)`, asserts `map.nodes.every((n) => n.cycle === undefined) === true`. |

## AC7 — No regressions; valid output

| AC id | Criterion text | Type | Test file | Assertion |
|-------|----------------|------|-----------|-----------|
| uses-edges.AC7.1 | Success: the full `bun test` suite passes. | unit (suite) | all of `tests/extract.test.ts`, `tests/analyze.test.ts`, `tests/diff.test.ts` | Running `bun test` shows all tests passing (expected ~12 pass, 1 skip — the env-gated differential skipped). This is the aggregate green-suite gate across all phases. |
| uses-edges.AC7.2 | Success: `bun run orrery build <repo>` still produces a valid self-contained HTML file containing `uses` edges. | integration / human-verification | none (operational build) | Manual/operational verification: `bun run orrery build tests/fixtures/repo --out <scratch>.html` and `bun run orrery build . --out <scratch>.html`, then `grep -c '"kind":"uses"' <out>` ≥ 1 and `head -c 200 <out>` begins with `<!DOCTYPE html>`. No automated test asserts on the rendered HTML artifact, so this is human-verification (a local build run on non-proprietary repos only: the fixture repo and orrery itself). |

## AC8 — Per-language fixtures

| AC id | Criterion text | Type | Test file | Assertion |
|-------|----------------|------|-----------|-----------|
| uses-edges.AC8.1 | Success: `tests/fixtures/repo` Python fixtures cover symbol-table + reference resolution (class→class, class→module, same-module, alias, exclusion). | unit | `tests/extract.test.ts` + `tests/fixtures/repo/pkg/*.py` | Fixtures `helpers.py`, `service.py`, `aliased.py`, `solo.py` (+ existing `base.py`/`impl.py`) cover every path; the two Python `uses` tests assert class→class, class→module fallback, same-module, alias, and self/external/unresolved exclusions. Existence + green tests verify this AC. |
| uses-edges.AC8.2 | Success: `tests/fixtures/repo` TS fixtures cover the same resolution behaviors. | unit | `tests/extract.test.ts` + `tests/fixtures/repo/web/*.ts`, `*.js` | Fixtures `base.ts`, `child.ts`, `aliased.ts` (+ existing `foo.ts`/`bar.ts`) and JS `shape.js`/`circle.js`; the TS and JS `uses` tests assert class→class extends, alias, and class→module fallback (and JS class→class). Existence + green tests verify this AC. |

---

## Coverage summary

| AC group | Cases | Automated | Human-verification (in part or full) |
|----------|-------|-----------|--------------------------------------|
| AC1 | AC1.1–AC1.5 | all | — |
| AC2 | AC2.1–AC2.5 | all | — |
| AC3 | AC3.1–AC3.3 | all | AC3.2 also deepened by AC5 differential |
| AC4 | AC4.1–AC4.2 | AC4.1 (edges), AC4.2 | AC4.1 zero-core-change `git diff` check |
| AC5 | AC5.1–AC5.2 | AC5.2 cause-guard (always-on) | AC5.1 (env-gated, proprietary); AC5.2 substance |
| AC6 | AC6.1–AC6.2 | all | — |
| AC7 | AC7.1–AC7.2 | AC7.1 (suite) | AC7.2 (valid HTML build) |
| AC8 | AC8.1–AC8.2 | all | — |

Every AC case maps to either an automated test or documented human verification;
none is unverified.

### Human-verification-only or partly-manual cases

- **uses-edges.AC4.1** — the "no edit to `src/extract/index.ts` / `src/graph/analyze.ts`" half is a one-time `git diff --name-only` review gate, not an assertion. (The functional half — TS/JS edges produced through the unchanged engine — is automated in `tests/extract.test.ts`.)
- **uses-edges.AC5.1** — env-gated differential against the proprietary reference prototype/repo; SKIPS by default and is exercised only by a local run with `ORRERY_DIFF_PROTOTYPE`/`ORRERY_DIFF_REPO` set. Justification: the prototype and repo are proprietary and cannot be committed or run in CI.
- **uses-edges.AC5.2** — automated cause-guard always runs; confirming that genuine diffs are truly explained happens during the same local differential run.
- **uses-edges.AC7.2** — producing a valid self-contained HTML containing `uses` edges is verified by a local `bun run orrery build` plus `grep`/`head` checks on non-proprietary targets (the fixture repo and orrery itself); no automated test inspects the rendered artifact.
