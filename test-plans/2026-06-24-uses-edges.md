# Human Test Plan — `uses` Edges

Feature: `uses`-edge extraction (class→class / class→module) as a per-language plugin capability for Python, TypeScript, TSX, and JavaScript.

Implementation plan: `docs/implementation-plans/2026-06-24-uses-edges/`
Coverage validation: **PASS** — 15/15 automated acceptance criteria covered by `bun test`; 4 criteria (AC4.1 zero-core-change gate, AC5.1 differential parity, AC5.2 cause substance, AC7.2 HTML artifact) are designated human/local verification.

## Prerequisites
- Working tree at HEAD `df26889`, branch `main`, repo root `/Users/kyle/code/orrery`.
- `bun` installed (v1.3.14+).
- `bun test` passing (baseline: 12 pass / 1 skip / 0 fail).
- A scratch directory for build artifacts (referred to below as `$SCRATCH`).
- For the optional differential (AC5.1): local copies of the proprietary reference prototype script and reference repo (**never committed**). Set `ORRERY_DIFF_PROTOTYPE`, `ORRERY_DIFF_REPO`, optionally `ORRERY_DIFF_PYTHON`.

## Phase A: Baseline suite + zero-core-change gate (AC4.1, AC7.1)
| Step | Action | Expected |
|------|--------|----------|
| A1 | Run `bun test` from repo root | `12 pass`, `1 skip`, `0 fail`; the single skip is the env-gated differential in `tests/diff.test.ts` |
| A2 | Run `git diff --name-only 4110984~1 4110984 -- src/extract/index.ts src/graph/analyze.ts` | Empty output — proves adding the TS/TSX/JS language required zero edits to the core engine/analyzer |
| A3 | Run `git diff --name-only 4110984~1 4110984` | Shows only `src/extract/plugins.ts`, test files, fixtures, and `.beads/*` — confirms the language was added purely as a plugin capability |

## Phase B: HTML build artifact contains uses edges (AC7.2)
| Step | Action | Expected |
|------|--------|----------|
| B1 | `bun run orrery build tests/fixtures/repo --out $SCRATCH/fixture.html` | Command exits 0, writes the file |
| B2 | `grep -c '"kind":"uses"' $SCRATCH/fixture.html` | Count ≥ 1 (uses edges embedded in the self-contained artifact) |
| B3 | `head -c 200 $SCRATCH/fixture.html` | Output begins with `<!DOCTYPE html>` |
| B4 | `bun run orrery build . --out $SCRATCH/orrery.html` (orrery itself — non-proprietary) | Exits 0; repeat B2/B3 checks: uses-edge count ≥ 1 and starts with `<!DOCTYPE html>` |
| B5 | Open `$SCRATCH/orrery.html` in a browser | Page renders the graph without console errors; nodes/edges visible |

## Phase C: Optional differential vs reference prototype (AC5.1, AC5.2 substance)
Run only with local proprietary artifacts. **Do not record the reference repo/prototype name anywhere.**
| Step | Action | Expected |
|------|--------|----------|
| C1 | Export `ORRERY_DIFF_PROTOTYPE=<local path to reference prototype script>`, `ORRERY_DIFF_REPO=<local path to reference repo>`, and (if needed) `ORRERY_DIFF_PYTHON=<python>` | env set |
| C2 | Run `bun test tests/diff.test.ts` | The previously-skipped "python uses edges match the reference prototype (AC5)" now runs |
| C3 | Observe result | Test passes: orrery's uses-edge set equals the reference prototype's modulo `tests/diff-allowlist.json` (currently empty) |
| C4 | If C3 fails with `onlyOrrery`/`onlyPrototype` entries | Inspect each diff; either it is a genuine bug (fix the extractor) or an accepted difference (add to `diff-allowlist.json` with a non-empty `cause`) |
| C5 | For every allowlist entry added, confirm the `cause` text genuinely explains the difference (AC5.2 substance), not a placeholder | Each cause is a real, reviewable justification |
| C6 | Record the outcome of this local run in beads `orrery-aoz` | Result logged |

## End-to-End: Mixed-language repo produces correct uses edges
Purpose: validate the full extract pipeline resolves cross-file class/module references into uses edges across Python, TS, and JS in one build, matching the design's id conventions.

1. From repo root, run `bun run orrery build tests/fixtures/repo --out $SCRATCH/e2e.html`.
2. Inspect the embedded JSON — confirm the Python class→class edge `repo.pkg.service:Service -> repo.pkg.base:Base` is present.
3. Confirm presence of the TS edge `repo.web.child:Child -> repo.web.base:Base` and the JS edge `repo.web.circle:Circle -> repo.web.shape:Shape` in the artifact.
4. Confirm absence of any edge mentioning `os`, `util`, or `self`, and absence of a self-edge `repo.pkg.solo:Solo -> repo.pkg.solo:Solo`.

Expected: all intended cross-file edges present; all excluded references absent — demonstrating resolution and exclusion behave end-to-end through the renderer, not just in unit tests.

## Human Verification Required
| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC4.1 (zero core change) | Reviewing that a contributor added a language without editing the engine is a judgment/review gate, not a runtime assertion | Phase A, steps A2–A3 |
| AC5.1 (reference-prototype parity) | Reference prototype + repo are proprietary and cannot run in CI | Phase C |
| AC5.2 (causes are real) | A human must judge whether each allowlist cause genuinely explains the diff | Phase C, steps C4–C5 |
| AC7.2 (valid HTML artifact) | No automated test inspects the rendered self-contained HTML | Phase B |

## Traceability
| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1–AC1.5 | tests/extract.test.ts (python uses + exclusions tests) | — |
| AC2.1–AC2.5 | tests/extract.test.ts (python/ts/js uses + dedup) | — |
| AC3.1–AC3.3 | tests/extract.test.ts (exclusions and dedup) | (AC3.2 also deepened by C2–C3) |
| AC4.1 | tests/extract.test.ts (TS/JS edges) | Phase A2–A3 |
| AC4.2 | tests/extract.test.ts (suite green, no errors) | — |
| AC5.1 | tests/diff.test.ts (env-gated) | Phase C |
| AC5.2 | tests/diff.test.ts (cause-guard, always-on) | Phase C5 |
| AC6.1 | tests/analyze.test.ts (AC6.1) | — |
| AC6.2 | tests/analyze.test.ts (AC6.2) | — |
| AC7.1 | full `bun test` suite | Phase A1 |
| AC7.2 | — | Phase B |
| AC8.1 | tests/extract.test.ts + pkg/*.py fixtures | — |
| AC8.2 | tests/extract.test.ts + web/*.ts,*.js fixtures | — |
