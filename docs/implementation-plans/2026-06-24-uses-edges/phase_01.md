# `uses` Edges Implementation Plan

**Goal:** Add `uses`-edge extraction (class→class / class→module references) to orrery's tree-sitter extractor as an optional, per-language `Plugin` capability.

**Architecture:** A new optional `uses?: UsesCapability` field on the existing per-language `Plugin` supplies two tree-sitter queries plus a thin `resolveSymbol`. A generic two-pass engine in `src/extract/index.ts` builds a per-file symbol table, scopes references to their enclosing class, applies self / own-module exclusions, and emits deduped `uses` edges — never naming a grammar node type. Python is implemented first as a vertical slice; TS/TSX/JS follow, reusing the engine unchanged.

**Tech Stack:** Bun (`bun test`, `bun:test`), TypeScript (strict, `noEmit`), `web-tree-sitter@0.22.6` with prebuilt grammars from `tree-sitter-wasms@0.1.13`.

**Scope:** 5 phases (the full design). This is Phase 1 of 5.

**Codebase verified:** 2026-06-24.

---

## Acceptance Criteria Coverage

Phase 1 is **infrastructure** (contract scaffolding). It implements no behavior and therefore tests no acceptance criteria directly.

**Verifies: None.** (Setup phase — verified operationally: existing tests still pass.)

---

## Context for the engineer

You are extending a small, working extractor. Today `src/extract/index.ts` does a single pass over every source file: it runs the plugin's tree-sitter `query`, registers `class` nodes, and emits `import` edges. This phase only **widens the contract** so later phases can plug in `uses` extraction without touching the interface again. **No runtime behavior changes in this phase.**

Key facts (already verified in the codebase):
- `Plugin` and `ResolveCtx` live in `src/extract/plugins.ts`.
- The orchestrator builds `ResolveCtx` once per file at `src/extract/index.ts:107`.
- Node id conventions: module = `repo.pkg.base`, class = `repo.pkg.base:Base` (i.e. `${moduleId}:${ClassName}`).
- `EdgeKind` in `src/schema.ts:38` already includes `"uses"` — no schema change needed.
- There is **no `tsc` dependency** installed. Type errors surface when Bun executes the TypeScript during `bun test`. Optional stricter check: `bunx tsc --noEmit` (downloads tsc ephemerally; `skipLibCheck` is on).

---

<!-- START_TASK_1 -->
### Task 1: Extend `ResolveCtx` and `Plugin`; add `UsesCapability`

**Files:**
- Modify: `src/extract/plugins.ts` (interfaces near lines 15–26)

**Step 1: Add `classIds` to `ResolveCtx`**

In `src/extract/plugins.ts`, change the `ResolveCtx` interface (currently lines 15–20) to add a `classIds` field:

```typescript
export interface ResolveCtx {
  importerId: string;
  importerPath: string;
  ids: Set<string>;
  pathToId: Map<string, string>;
  /** All intra-repo class node ids (e.g. "repo.pkg.base:Base"); lets a
   *  resolver prefer a class over its module. Populated in extract() pass 1. */
  classIds: Set<string>;
}
```

**Step 2: Add the `UsesCapability` interface**

Add this interface directly above the `Plugin` interface (the capture-name comment block at the top of the file documents the existing capture vocabulary; mirror that style):

```typescript
/**
 * Optional per-language `uses`-edge extraction. The orchestrator owns all the
 * generic logic; a plugin only supplies two tree-sitter queries plus a thin
 * resolver. Capture-name vocabulary (the orchestrator bins captures by name):
 *
 *   symbolQuery captures (grouped per import via Query.matches):
 *     @sym.local  the bound local name (alias if aliased)
 *     @sym.src    the module / dotted-path / string specifier
 *     @sym.name   the imported leaf name, for `from`-style imports (optional)
 *
 *   referenceQuery captures (flat, via Query.captures):
 *     @def.class  a class name node — its .parent spans the class body, used to
 *                 scope references to their enclosing class
 *     @ref        a candidate referenced identifier (attribute-chain root,
 *                 heritage/base type, or a load identifier)
 *     @skip       identifier positions to subtract from @ref by source position
 *                 (e.g. an attribute's property name in `a.b.c`)
 */
export interface UsesCapability {
  symbolQuery: string;
  referenceQuery: string;
  /** Map an import binding to an intra-repo node id, class-preferred with module
   *  fallback. `name` is the imported leaf for `from`-style imports (else null). */
  resolveSymbol(spec: string, name: string | null, ctx: ResolveCtx): string | null;
}
```

**Step 3: Add the optional `uses` field to `Plugin`**

Change the `Plugin` interface (currently lines 22–26) to:

```typescript
export interface Plugin {
  grammar: string;
  query: string;
  resolveImport(spec: string, ctx: ResolveCtx): string | null;
  /** Optional `uses`-edge extraction. Absent = language emits no uses edges. */
  uses?: UsesCapability;
}
```

**Step 4: Verify it compiles (will fail until Task 2)**

Run: `bun test`
Expected at this point: a **type error** in `src/extract/index.ts` because the `ctx` object built there does not yet include the now-required `classIds`. That is fixed in Task 2. (If you prefer, do Tasks 1 and 2 back-to-back before running anything.)

**No commit yet** — commit after Task 2 so the tree is always green.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Thread `classIds` into the `ResolveCtx` in the orchestrator

**Files:**
- Modify: `src/extract/index.ts` (the `extract` function, around lines 82–107)

**Step 1: Declare a `classIds` set alongside the other accumulators**

In `src/extract/index.ts`, the `extract` function currently declares (lines 82–84):

```typescript
  const edges: CodeEdge[] = [];
  const edgeSeen = new Set<string>();
  const classSeen = new Set<string>();
```

Add a `classIds` set right after `classSeen`:

```typescript
  const edges: CodeEdge[] = [];
  const edgeSeen = new Set<string>();
  const classSeen = new Set<string>();
  const classIds = new Set<string>(); // all class node ids; consumed by uses extraction (Phase 2)
```

**Step 2: Include `classIds` when constructing `ctx`**

Change the `ctx` construction (currently line 107):

```typescript
    const ctx = { importerId: file.id, importerPath: file.path, ids, pathToId };
```

to:

```typescript
    const ctx = { importerId: file.id, importerPath: file.path, ids, pathToId, classIds };
```

> Note: `classIds` stays empty in this phase. `resolveImport` does not read it, so behavior is unchanged. Phase 2 populates it during pass 1 and consumes it in pass 2. We deliberately do **not** populate it here to keep this phase behavior-neutral.

**Step 3: Verify no behavior change**

Run: `bun test`
Expected:
```
 5 pass
 0 fail
```
(The same 5 tests that passed before — `tests/extract.test.ts` ×2, `tests/analyze.test.ts` ×3.)

Optional stricter type check:
Run: `bunx tsc --noEmit`
Expected: no errors.

**Step 4: Commit**

```bash
git add src/extract/plugins.ts src/extract/index.ts
git commit -m "feat(extract): scaffold uses-edge plugin contract (orrery-0cp)

Add UsesCapability interface and optional Plugin.uses field; add classIds
to ResolveCtx and thread an (empty) set through extract(). No behavior change.

Refs: orrery-2uv, orrery-toj"
```
<!-- END_TASK_2 -->

---

## Phase 1 Done When

- `src/extract/plugins.ts` defines `UsesCapability`, `Plugin.uses?`, and `ResolveCtx.classIds`.
- `src/extract/index.ts` constructs `ctx` with a `classIds` set.
- `bun test` shows **5 pass / 0 fail** (no regressions, no new behavior).
- Changes committed.
