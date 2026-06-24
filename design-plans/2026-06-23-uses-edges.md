# `uses` Edges Design

> Status: **Complete** — design validated and documented (Phases 1–5). Ready for
> an implementation plan. Tracking: beads `orrery-2uv` (feature), `orrery-zhc`
> (design epic); renderer follow-up `orrery-d0a`. Decisions logged in deciduous
> (goal node 6; architecture decisions 11–12).

## Summary

Orrery extracts a graph of nodes (modules, classes) and edges (imports,
dependencies) from a codebase and renders it as a self-contained HTML map.
Today it tracks **import** edges (which file pulls in which) but not **uses**
edges — the finer question of which classes actually reference which other
classes at the symbol level. The renderer already has a `uses` toggle; nothing
produces them yet.

This feature adds `uses`-edge extraction as an **optional, per-language
capability** on the existing `Plugin` interface. Each plugin contributes two
tree-sitter queries — one capturing import bindings into a per-module symbol
table, one capturing referenced identifiers inside class bodies — plus a thin
`resolveSymbol`. A new generic two-pass engine in the orchestrator
(`src/extract/index.ts`) builds the symbol table, scopes each reference to its
enclosing class, applies exclusion rules, and emits deduplicated `uses` edges,
without ever knowing a grammar node type. Python is implemented first as a
proven vertical slice (a validated prototype exists to diff against); TypeScript,
TSX, and JavaScript follow, reusing the engine unchanged. Adding a future
language requires zero core changes.

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

### uses-edges.AC1: Per-module symbol table maps local names to node ids
- **uses-edges.AC1.1 Success:** A plain import (`import a.b`) binds the local name
  to the resolved module node id.
- **uses-edges.AC1.2 Success:** An aliased import (`import a.b as c` / `import {x as y}`)
  binds the **alias** to the target node id.
- **uses-edges.AC1.3 Success:** A `from`-style import of a class
  (`from .base import Base`) binds the local name to the **class** node id
  (`module:Base`), not the module.
- **uses-edges.AC1.4 Success:** A same-module top-level class is present in the
  table mapped to its own class node id.
- **uses-edges.AC1.5 Failure:** An external/stdlib import (`import os`,
  bare specifier) resolves to null and adds no table entry.

### uses-edges.AC2: Class references resolve into uses edges
- **uses-edges.AC2.1 Success (class→class):** A class extending/subclassing an
  imported class emits a `uses` edge to that class node
  (e.g. `repo.pkg.impl:Impl → repo.pkg.base:Base`).
- **uses-edges.AC2.2 Success (class→module fallback):** A class referencing an
  imported module-level function/constant emits a `uses` edge to the **module**
  node (e.g. `repo.web.bar:Bar → repo.web.foo`).
- **uses-edges.AC2.3 Success (same-module):** A class referencing another
  top-level class in its own module emits a `uses` edge to that class node.
- **uses-edges.AC2.4 Edge:** The root of an attribute/member chain is the
  referenced name (`a.b.c` ⇒ `a`); the property names (`b`, `c`) do **not**
  produce edges.
- **uses-edges.AC2.5 Edge:** Duplicate references within one class produce a
  single deduped edge.

### uses-edges.AC3: Exclusions match the prototype
- **uses-edges.AC3.1 Failure (self):** A class referencing its own name emits no
  `uses` edge.
- **uses-edges.AC3.2 Failure (own-module):** A reference that resolves only to the
  class's own module emits no `uses` edge.
- **uses-edges.AC3.3 Failure (unresolved):** A reference with no symbol-table
  entry (local variable, parameter, external name) emits no edge.

### uses-edges.AC4: Pluggable — adding a language requires zero core changes
- **uses-edges.AC4.1 Success:** Implementing `UsesCapability` on the TS/TSX/JS
  plugins produces `uses` edges with **no edit** to `src/extract/index.ts` or
  `src/graph/analyze.ts`.
- **uses-edges.AC4.2 Success:** A plugin without a `uses` field (structure-only or
  import-only language) emits no `uses` edges and does not error.

### uses-edges.AC5: Python parity vs the prototype
- **uses-edges.AC5.1 Success:** On the reference repo, orrery's `uses` edge set
  equals the prototype's, modulo a documented allowlist of acceptable diffs.
- **uses-edges.AC5.2 Success:** Every accepted diff has a written cause
  (e.g. the load-vs-store approximation).

### uses-edges.AC6: uses edges participate in centrality
- **uses-edges.AC6.1 Success:** `uses` edges feed PageRank (a node depended on
  only via `uses` edges receives centrality from them).
- **uses-edges.AC6.2 Failure:** `uses` edges do **not** create import-cycle
  (`cycle`) annotations — SCC detection stays import-only.

### uses-edges.AC7: No regressions; valid output
- **uses-edges.AC7.1 Success:** The full `bun test` suite passes.
- **uses-edges.AC7.2 Success:** `bun run orrery build <repo>` still produces a
  valid self-contained HTML file containing `uses` edges.

### uses-edges.AC8: Per-language fixtures
- **uses-edges.AC8.1 Success:** `tests/fixtures/repo` Python fixtures cover
  symbol-table + reference resolution (class→class, class→module, same-module,
  alias, exclusion).
- **uses-edges.AC8.2 Success:** `tests/fixtures/repo` TS fixtures cover the same
  resolution behaviors.

## Glossary

- **`uses` edge**: A directed edge from a class node to another class (or a
  module, as fallback) meaning the source class references the target by name —
  subclasses it, calls it, instantiates it. Distinct from an `import` edge
  (file-level import statement).
- **`CodeMap`**: Orrery's internal graph structure (nodes + edges) passed from
  the extractor to the renderer; the stable contract between the two.
- **`Plugin`**: A per-language object (`src/extract/plugins.ts`) supplying a
  grammar, a tree-sitter `query` for structure/imports, and an import resolver.
  This feature adds an optional `uses?: UsesCapability` field.
- **`UsesCapability`**: The new optional interface encapsulating everything
  language-specific about `uses` extraction: `symbolQuery`, `referenceQuery`,
  and `resolveSymbol`.
- **symbol table**: A per-file `Map<localName, nodeId>` built in pass 2 from the
  file's imports plus its own top-level classes; maps a name as written in
  source to an intra-repo node id. It is the real filter — a name absent from it
  produces no edge.
- **intra-repo node id**: A stable id for a node in the graph (e.g.
  `repo.pkg.base:Base` for a class, `repo.pkg.base` for a module). External
  targets have no id and produce no edges.
- **`resolveImport` / `resolveSymbol`**: Plugin functions (existing / new) that
  convert a raw import specifier into an intra-repo node id, or `null` for
  external/stdlib targets. `resolveSymbol` is class-preferred with module
  fallback.
- **`ResolveCtx`**: Context passed to resolvers — importer id/path, the set of
  all node ids, and (new) `classIds`, used to prefer a class over its module.
- **tree-sitter**: The parser library orrery uses; plugins supply query strings
  that pattern-match the syntax tree.
- **capture name**: A named match in a tree-sitter query (e.g. `@ref`,
  `@sym.local`, `@skip`) that the orchestrator retrieves and bins by name — the
  vocabulary that keeps the orchestrator language-agnostic.
- **`@skip` / skip-by-position subtraction**: A mechanism that removes certain
  `@ref` nodes by their source position — used to drop attribute property names
  (`b`, `c` in `a.b.c`) that queries can't exclude structurally.
- **load-vs-store approximation**: tree-sitter queries can't distinguish a name
  being read from one being assigned, so the engine may over-emit; differences
  are tracked in a documented allowlist rather than coded around.
- **PageRank / centrality**: Graph ranking in `src/graph/analyze.ts` reflecting
  how depended-upon a node is. It consumes all edge kinds, so `uses` edges feed
  it automatically once emitted.
- **SCC / cycle detection**: Strongly-connected-component analysis flagging
  import cycles; operates on `import` edges only, so `uses` edges never create
  false cycles.
- **reference repo / Python prototype**: A validated Python reference
  implementation (and the real repo it runs on) used as ground truth for the
  Phase 3 Python differential test.
- **vertical slice**: Delivering one complete end-to-end path (Python plugin +
  engine + tests) before expanding breadth (TS/JS), validating the full pipeline
  on one language first.
- **`orrery-487` / `orrery-dom` / `orrery-d0a`**: Beads issues for out-of-scope
  related work — function-level zoom-in, language-breadth expansion, and
  renderer-side granularity/edge-kind filtering, respectively.

## Architecture

**Approach (brainstorming option C — Hybrid).** `uses` extraction is added as an
**optional capability** on the existing per-language `Plugin`. The plugin
contributes the language-specific knowledge as *data* (two tree-sitter queries)
plus one thin resolver; the orchestrator (`src/extract/index.ts`) owns all the
generic logic (symbol-table assembly, reference-to-class scoping, exclusion,
edge emission). This mirrors the established `Plugin` shape — a declarative
`query` string plus an imperative `resolveImport` — so adding a language stays a
zero-core-change operation, satisfying the breadth goal tracked in `orrery-dom`.

### The `Plugin` contract

```typescript
export interface UsesCapability {
  /** Captures import bindings. Capture names:
   *  @sym.local (bound local name), @sym.src (module/dotted-path or string
   *  specifier), @sym.name? (imported leaf, for `from`-style imports). */
  symbolQuery: string;

  /** Captures referenced identifiers inside class bodies. Capture names:
   *  @def.class (class name node, for enclosing-class scoping),
   *  @ref (candidate referenced identifier: name/attribute-chain root or
   *  base/heritage type), @skip (identifier positions to exclude, e.g. an
   *  attribute's property name). */
  referenceQuery: string;

  /** Map an import binding to an intra-repo node id, class-preferred with
   *  module fallback. `name` is the imported leaf for `from`-style imports
   *  (null otherwise). Reuses resolveImport for the module half. */
  resolveSymbol(spec: string, name: string | null, ctx: ResolveCtx): string | null;
}

export interface Plugin {
  grammar: string;
  query: string;                                              // existing
  resolveImport(spec: string, ctx: ResolveCtx): string | null; // existing
  uses?: UsesCapability;                                       // NEW (optional)
}

export interface ResolveCtx {
  importerId: string;
  importerPath: string;
  ids: Set<string>;
  pathToId: Map<string, string>;
  classIds: Set<string>;  // NEW — lets resolveSymbol prefer a class over its module
}
```

### Data flow

Extraction becomes a **two-pass** walk over source files.

**Pass 1 — structure + imports + class nodes (unchanged, one addition).** Runs
`plugin.query`, emits `import` edges via `resolveImport`, registers `class`
nodes — exactly as today. The single addition: every class id is accumulated
into `classIds`, which is added to `ResolveCtx` for pass 2.

**Pass 2 — uses edges (new; only for files whose plugin defines `uses`):**

1. **Build the per-module symbol table** (`Map<localName, nodeId>`):
   - Run `uses.symbolQuery`; for each `(@sym.local, @sym.src, @sym.name?)`, call
     `resolveSymbol(src, name, ctx)` and, if non-null, set
     `table[local] = nodeId`.
   - Add same-module top-level classes **generically**: for each class node with
     `module === file.id`, set `table[ClassName] = classId`.
2. **Scope references to their enclosing class.** Run `uses.referenceQuery`. The
   orchestrator subtracts `@skip` nodes from `@ref` nodes **by source position**
   (a generic mechanism — the language-specific exclusions live in the query),
   then for each surviving `@ref` walks `node.parent` up to the nearest
   class-definition node to find its owning class id. Refs with no enclosing
   class are dropped.
3. **Resolve, filter, emit.** For each `(enclosingClassId, refText)`: look up
   `table[refText]`; if found as `target`, emit
   `{ source: enclosingClassId, target, kind: "uses" }` **unless**
   `target === enclosingClassId` (self) or `target === file.id`
   (own-module-only). Dedup via the existing `edgeSeen` set.

The orchestrator never references a grammar node type — only the capture-name
vocabulary and parent-chain geometry. All node-type knowledge is confined to the
plugin's two queries and `resolveSymbol`.

### Edge granularity and display

A `uses` edge targets the **most specific known node**: a class when the
referenced name resolves to one, otherwise its module (faithful to the
prototype). This keeps the class dependency layer complete and loses no signal,
at the cost of `class→module` edges mixing granularities in one scene. Telling
"module relations vs class relations vs all" at a glance is deferred to a
separate **renderer** feature (`orrery-d0a`), enabled for free because every edge
endpoint already carries its node `kind` and the parent hierarchy is in the
`CodeMap`. This feature stays scoped to extraction.

### Graph analysis — no changes

`src/graph/analyze.ts::augment` already runs PageRank over all
`module/file/class/function` nodes using **every** edge kind, and restricts
SCC/cycle detection to `import` edges only. So `uses` edges automatically feed
centrality the moment they appear (matching the prototype's `_augment`) and
cannot fabricate false import cycles. `analyze.ts` is not touched.

## Existing Patterns

This design follows patterns already established in `src/extract/`:

- **Capture-name convention + thin resolver.** The current `Plugin` pairs a
  declarative `query` (capture names `@imp.abs`, `@imp.from`, `@imp.src`,
  `@def.class`) with an imperative `resolveImport`. The orchestrator bins
  captures by name and calls the resolver. `UsesCapability` extends exactly this
  pattern with a second query pair and `resolveSymbol`.
- **Generic class-node detection.** `index.ts` already discovers class nodes
  generically by binning `@def.class` captures; enclosing-class scoping in pass 2
  reuses the same class ids.
- **Optional, additive plugin surface.** Languages without a plugin already
  degrade to structure-only. Making `uses` an optional `Plugin` field continues
  this: a plugin without `uses` simply emits no `uses` edges.
- **Resolver semantics ported from the prototype.** `resolveSymbol` mirrors the
  prototype's `_imported_symbol_target` (class → submodule → module), and the
  exclusion rules mirror `_uses_edges` (skip self / own-module).

No divergence from existing structure. The only new mechanism is `@skip`-by-position
subtraction, introduced because tree-sitter queries cannot express load-vs-store
context or "attribute root only" the way Python's `ast` can.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Contract scaffolding
**Goal:** Extend the plugin contract so the capability can be implemented without
touching it again.

**Components:**
- `src/extract/plugins.ts` — add `UsesCapability` interface and optional
  `uses?: UsesCapability` on `Plugin`; add `classIds: Set<string>` to
  `ResolveCtx`.
- `src/extract/index.ts` — thread a `classIds` set into the `ResolveCtx`
  constructed during extraction (populated in Phase 2's pass 1).

**Dependencies:** None.

**Done when:** `bun run` typechecks and `bun test` (existing 5 tests) still
passes. No behavior change yet.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Generic uses engine + Python capability (vertical slice)
**Goal:** The language-agnostic pass-2 engine, plus the Python `UsesCapability`
that proves it end-to-end (the proven-slice-first decision).

**Components:**
- `src/extract/index.ts` — pass 1 accumulates `classIds`; pass 2 (run only when
  `plugin.uses` exists) builds the symbol table, performs `@skip`-by-position
  subtraction, scopes `@ref` to the enclosing class, applies self / own-module
  exclusion, and emits deduped `uses` edges.
- `src/extract/plugins.ts` — Python `uses`: `symbolQuery` (plain/aliased/`from`
  imports), `referenceQuery` (base classes, attribute roots with property-name
  `@skip`, load identifiers), and `resolveSymbol` (class → submodule → module).
- `tests/fixtures/repo/pkg/` — extend Python fixtures to exercise imported-base,
  same-module, module-fallback, alias, and exclusion cases.
- `tests/extract.test.ts` — `uses` edge assertions for Python.

**Dependencies:** Phase 1.

**Covers:** `uses-edges.AC1.*`, `uses-edges.AC2.*` (Python), `uses-edges.AC3.*`,
`uses-edges.AC8.1`.

**Done when:** the new Python `uses` fixture tests pass and existing tests still
pass.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Python differential gate
**Goal:** Prove Python parity against the validated prototype on a real repo.

**Components:**
- `tests/` — a differential harness that runs the prototype's `extract.py` on the
  reference repo and orrery's extractor on the same repo, then asserts set-equality
  on `uses` edges modulo a documented allowlist of acceptable diffs.
- A short `docs/` note (or test comment) enumerating accepted diffs and their
  cause (e.g. the load-vs-store approximation).

**Dependencies:** Phase 2.

**Covers:** `uses-edges.AC5.*`.

**Done when:** the differential test passes within the documented allowlist.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: TypeScript / TSX / JavaScript capability
**Goal:** Add `uses` to the JS-family plugins, reusing the engine unchanged.

**Components:**
- `src/extract/plugins.ts` — `uses` for `typescript`, `tsx`, `javascript`:
  `symbolQuery` (named / aliased / namespace / default imports), `referenceQuery`
  (heritage `extends`/`implements`, `member_expression` roots, value + type
  identifiers; no `@skip` needed since `property_identifier` is distinct),
  shared `resolveSymbol` reusing `jsResolve`.
- `tests/fixtures/repo/web/` — extend TS fixtures for class→class (imported
  base/extends), class→module (calling an imported function), and alias cases.
- `tests/extract.test.ts` — `uses` edge assertions for TS.

**Dependencies:** Phase 2 (engine). Independent of Phase 3.

**Covers:** `uses-edges.AC2.*` (TS), `uses-edges.AC4.*`, `uses-edges.AC8.2`.

**Done when:** the new TS `uses` fixture tests pass; adding these plugins required
no change to `src/extract/index.ts`.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Integration verification
**Goal:** Confirm the feature works end-to-end at scale and through the renderer.

**Components:**
- Verify `bun run orrery build <reference-repo>` and `bun run orrery build <orrery>`
  produce valid self-contained HTML containing `uses` edges.
- Confirm `uses` edges participate in PageRank (centrality reflects them) and
  produce no spurious import cycles.

**Dependencies:** Phases 2–4.

**Covers:** `uses-edges.AC6.*`, `uses-edges.AC7.*`.

**Done when:** both builds yield valid HTML, `uses` edges are present and ranked,
and the full `bun test` suite passes.
<!-- END_PHASE_5 -->

## Additional Considerations

**Load-vs-store approximation.** tree-sitter queries cannot model assignment
context, so a stored name that shadows an import could over-emit a `uses` edge.
Impact is low because the symbol table is the real filter (a name absent from the
table produces no edge). Any resulting differences are captured in Phase 3's
documented diff allowlist rather than worked around in code.

**Nested classes.** v1 attributes references to the nearest enclosing class via
parent-chain scoping. This matches the class-level scope; function-level "zoom in"
is explicitly deferred to `orrery-487`.

**`@skip` is per-position, not per-name.** Subtraction is by source position so a
name used legitimately elsewhere in the same class is unaffected when one of its
occurrences sits in a skipped position.
