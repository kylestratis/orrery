# `uses` Edges Design

> Status: **WIP** — Definition of Done confirmed (design Phase 3). Architecture
> brainstorming (Phase 4) and full documentation (Phase 5) still to come.
> Tracking: beads `orrery-2uv` (feature), `orrery-zhc` (design epic).
> Decisions logged in deciduous (goal node 6).

## Summary
<!-- TO BE GENERATED after body is written -->

## Definition of Done

**Primary deliverable:** orrery's tree-sitter extractor emits `uses` edges
(source = class node; target = class node, falling back to the module) flowing
through the `CodeMap` into the existing renderer (the `uses` edge toggle already
exists). `uses` extraction is a **per-plugin capability**, so it applies to every
current and future language plugin.

**Success criteria:**
- Per-module **symbol table** built from imports (including aliases) + same-module
  classes, mapping local names → intra-repo node ids (class preferred, module
  fallback) — provided per language by its plugin.
- Each class's **referenced identifiers** resolve through that table into `uses`
  edges, excluding self / own-module-only references (prototype semantics).
- **Pluggable architecture:** the `Plugin` interface gains a `uses`-extraction
  capability (symbol-capture query/logic + reference scan). The orchestrator
  (`src/extract/index.ts`) stays language-agnostic. Adding a language
  (structure + import + class + uses) requires **zero core changes**.
- **Python parity:** a differential test vs the validated Python prototype's
  `uses` edges on the reference repo passes (modulo documented acceptable diffs).
- **Per-language fixtures:** unit tests on `tests/fixtures/repo` cover symbol-table
  + reference resolution for Python and TS at minimum.
- `uses` edges **participate in PageRank/centrality** (matching the prototype,
  which feeds all edge kinds into rank).
- All existing tests pass; `bun run orrery build <repo>` still yields a valid
  self-contained HTML.

**Scope (v1):** the languages that currently have plugins — Python (proven slice
first), then TS/TSX/JS. Python validates against the prototype; TS/JS validate via
fixtures.

**Out of scope (v1):**
- Function-level / sub-class "zoom in" → deferred to beads `orrery-487`.
- `registers` / `calls` dynamic-analysis edges (agent `--augment` path).
- Language breadth beyond the current 4 plugins → tracked in `orrery-dom`
  (top-10 + Elixir), which builds on this feature's pluggable `uses` capability.

## Acceptance Criteria
<!-- TO BE GENERATED and validated before glossary -->

## Glossary
<!-- TO BE GENERATED after body is written -->
