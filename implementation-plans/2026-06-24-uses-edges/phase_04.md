# `uses` Edges — Phase 4: TypeScript / TSX / JavaScript capability

**Goal:** Add the `uses` capability to the JS-family plugins, reusing the Phase 2 engine **unchanged** — proving the pluggable, zero-core-change claim.

**Scope:** Phase 4 of 5. Depends on Phase 2 (the engine). Independent of Phase 3.

**Codebase verified:** 2026-06-24.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### uses-edges.AC2: Class references resolve into uses edges (TypeScript)
- **uses-edges.AC2.1 Success (class→class):** A class extending an imported class emits a `uses` edge to that class node.
- **uses-edges.AC2.2 Success (class→module fallback):** A class referencing an imported module-level function emits a `uses` edge to the **module** node.
- **uses-edges.AC2.4 Edge:** The root of a member chain is the referenced name; property names do **not** produce edges.

### uses-edges.AC4: Pluggable — adding a language requires zero core changes
- **uses-edges.AC4.1 Success:** Implementing `UsesCapability` on the TS/TSX/JS plugins produces `uses` edges with **no edit** to `src/extract/index.ts` or `src/graph/analyze.ts`.
- **uses-edges.AC4.2 Success:** A plugin without a `uses` field emits no `uses` edges and does not error.

### uses-edges.AC8.2: Per-language fixtures (TypeScript)
- **uses-edges.AC8.2 Success:** `tests/fixtures/repo` TS fixtures cover the same resolution behaviors.

---

## Why this phase needs no engine changes

The engine from Phase 2 is driven entirely by capture names (`@sym.local`,
`@sym.src`, `@sym.name`, `@def.class`, `@ref`, `@skip`) and node geometry
(`.parent`, `.startIndex`, `.endIndex`). The JS family just supplies its own
queries + `resolveSymbol`. **If you find yourself editing `src/extract/index.ts`
in this phase, stop — the design is violated.** (One subtlety: JS does **not**
need `@skip`, because member-expression property names are a distinct
`property_identifier` node, so a `(identifier)`/`(type_identifier)` `@ref` never
captures them.)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add a shared JS-family `UsesCapability`

**Files:**
- Modify: `src/extract/plugins.ts`

**Step 1: Add `jsResolveSymbol` (class-preferred, module fallback)**

Add near `jsResolve` in `src/extract/plugins.ts`:

```typescript
/** Resolve a JS/TS import binding to a node id: prefer the class, then the module.
 *  For `import { Name } from "./mod"`, `name` is the imported leaf. */
function jsResolveSymbol(spec: string, name: string | null, ctx: ResolveCtx): string | null {
  const mod = jsResolve(spec, ctx); // module id, or null for bare/external
  if (mod && name) {
    const classId = `${mod}:${name}`;
    if (ctx.classIds.has(classId)) return classId;
  }
  return mod;
}
```

**Step 2: Add shared TS/TSX query constants and a `uses` capability**

Above the `typescript`/`tsx` plugin objects, add:

```typescript
const TS_SYMBOL_QUERY = `
  ; import { Orig as Local } from "./mod"   (aliased named import)
  (import_statement
    (import_clause (named_imports
      (import_specifier name: (identifier) @sym.name alias: (identifier) @sym.local)))
    source: (string) @sym.src)
  ; import { Name } from "./mod"            (no alias: bind the name as BOTH)
  (import_statement
    (import_clause (named_imports
      (import_specifier !alias name: (identifier) @sym.name @sym.local)))
    source: (string) @sym.src)
  ; import Local from "./mod"               (default import)
  (import_statement
    (import_clause (identifier) @sym.local)
    source: (string) @sym.src)
  ; import * as ns from "./mod"             (namespace import)
  (import_statement
    (import_clause (namespace_import (identifier) @sym.local))
    source: (string) @sym.src)
`;

const TS_REFERENCE_QUERY = `
  ; class names (for enclosing-class scoping)
  (class_declaration name: (type_identifier) @def.class)
  (abstract_class_declaration name: (type_identifier) @def.class)
  ; heritage: extends / implements
  (extends_clause (identifier) @ref)
  (extends_clause (member_expression object: (identifier) @ref))
  (implements_clause (type_identifier) @ref)
  ; member-expression roots (property_identifier is a distinct node, so not captured)
  (member_expression object: (identifier) @ref)
  ; value identifiers and type references
  (identifier) @ref
  (type_identifier) @ref
`;

const tsUses: UsesCapability = {
  symbolQuery: TS_SYMBOL_QUERY,
  referenceQuery: TS_REFERENCE_QUERY,
  resolveSymbol: jsResolveSymbol,
};
```

> **Why two named-import patterns (verified against the real grammar).** An
> `import_specifier` with no `alias` does **not** populate a separate alias node,
> so a single `alias: (identifier)? @sym.local` pattern leaves `@sym.local`
> **absent** for the common `import { Base } from './base'` form — the engine's
> `if (!local || !spec) continue;` guard would then silently drop it. The fix is
> the two explicit patterns above: the aliased pattern binds `@sym.local` to the
> alias; the no-alias pattern (`!alias`) binds the name node as **both**
> `@sym.name` and `@sym.local`. This was checked against `tree-sitter-typescript`
> and yields: `{ Base }` → `sym.name=Base, sym.local=Base`; `{ Base as B }` →
> `sym.name=Base, sym.local=B`; `{ foo }` → `sym.name=foo, sym.local=foo`. Keeping
> `@sym.name` is what lets `jsResolveSymbol` prefer the **class** id
> (`repo.web.base:Base`) over the module — required by the `child.ts`/`aliased.ts`
> assertions.
>
> **Default and namespace imports** bind `@sym.local` but no `@sym.name`, so
> `jsResolveSymbol` resolves them to the **module** id (you cannot name a class
> leaf through `import X` / `import * as ns`). That is the intended behavior; a
> reference through such a binding produces a class→module edge.
>
> All of this lives in the plugin queries/resolver — **never touch `index.ts`.**

**Step 3: Wire `uses` into `typescript` and `tsx`**

Change (lines 87–88):

```typescript
const typescript: Plugin = { grammar: "typescript", query: TS_QUERY, resolveImport: jsResolve };
const tsx: Plugin = { grammar: "tsx", query: TS_QUERY, resolveImport: jsResolve };
```

to:

```typescript
const typescript: Plugin = { grammar: "typescript", query: TS_QUERY, resolveImport: jsResolve, uses: tsUses };
const tsx: Plugin = { grammar: "tsx", query: TS_QUERY, resolveImport: jsResolve, uses: tsUses };
```

**Step 4: Wire `uses` into `javascript`**

The `javascript` plugin (lines 90–98) uses `(identifier)` for class names (no
`type_identifier`). Give it a JS-specific reference query but the shared symbol
query + resolver:

```typescript
const JS_REFERENCE_QUERY = `
  (class_declaration name: (identifier) @def.class)
  (class_heritage (identifier) @ref)
  (class_heritage (member_expression object: (identifier) @ref))
  (member_expression object: (identifier) @ref)
  (identifier) @ref
`;

const javascript: Plugin = {
  grammar: "javascript",
  query: `
    (import_statement source: (string) @imp.src)
    (export_statement source: (string) @imp.src)
    (class_declaration name: (identifier) @def.class)
  `,
  resolveImport: jsResolve,
  uses: {
    symbolQuery: TS_SYMBOL_QUERY,
    referenceQuery: JS_REFERENCE_QUERY,
    resolveSymbol: jsResolveSymbol,
  },
};
```

> Note `UsesCapability` must be imported/visible in scope — it is declared in the
> same file (Phase 1), so just reference the type. If TS complains about the
> `UsesCapability` annotation on `tsUses`, ensure the interface is declared above
> these objects (move the const below the interface, which is near the top).
>
> **`JS_REFERENCE_QUERY` node types are verified** against `tree-sitter-javascript`:
> `class extends Shape` → `(class_heritage (identifier))` captures `Shape`;
> `class extends ns.Base` → `(class_heritage (member_expression object: (identifier)))`
> captures the root `ns`; method-body references and member roots are captured by
> the `(member_expression object: (identifier))` and bare `(identifier)` patterns.
> The JS class name is `(identifier)` (not `type_identifier`). If a JS query
> pattern is malformed, `parsed.lang.query(...)` throws and the engine's try/catch
> sets `refCaps = []` — i.e. it fails **silently** to zero edges. The JS test in
> Task 3 exists specifically to make that failure loud.

**Step 5: Verify Python still passes and nothing errors**

Run: `bun test`
Expected: the 7 Python-era tests still pass (TS fixtures/tests come in Tasks 2–3). No errors from the new queries.

**No commit yet** — commit after TS fixtures + tests pass (Task 3).
<!-- END_TASK_1 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 2-3) -->

<!-- START_TASK_2 -->
### Task 2: Add TypeScript fixtures

**Files:**
- Create: `tests/fixtures/repo/web/base.ts`
- Create: `tests/fixtures/repo/web/child.ts`
- Create: `tests/fixtures/repo/web/aliased.ts`
- Create: `tests/fixtures/repo/web/shape.js`
- Create: `tests/fixtures/repo/web/circle.js`

Additive only — existing `web/foo.ts` and `web/bar.ts` are unchanged. Note
`web/bar.ts` already exercises **class→module fallback** (`Bar` calls imported
`foo`, which is a function in `web/foo.ts` → resolves to module `repo.web.foo`).

**Step 1: `tests/fixtures/repo/web/base.ts`**

```typescript
export class Base {}
```

**Step 2: `tests/fixtures/repo/web/child.ts`** (class→class via `extends`)

```typescript
import { Base } from './base';

export class Child extends Base {
  run() { return 1; }
}
```

Expected: `repo.web.child:Child -> repo.web.base:Base` (AC2.1).

**Step 3: `tests/fixtures/repo/web/aliased.ts`** (aliased import)

```typescript
import { Base as B } from './base';

export class Aliased extends B {}
```

Expected: `repo.web.aliased:Aliased -> repo.web.base:Base` (AC1.2 for TS).

**Step 4: `tests/fixtures/repo/web/shape.js`** (JavaScript base class — verifies the `javascript` plugin, not just TS)

```javascript
export class Shape {}
```

**Step 5: `tests/fixtures/repo/web/circle.js`** (JS class→class via `extends` of an imported class)

```javascript
import { Shape } from './shape';

export class Circle extends Shape {
  draw() { return Shape; }
}
```

Expected: `repo.web.circle:Circle -> repo.web.shape:Shape` (JS class→class; verified against `tree-sitter-javascript`).

**No commit yet** — commit with tests in Task 3.
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add TypeScript `uses`-edge tests; confirm zero core changes

**Verifies:** uses-edges.AC2.1 (TS+JS), AC2.2 (TS), AC2.4 (TS), AC4.1, AC4.2, AC8.2

**Files:**
- Modify: `tests/extract.test.ts`

**Step 1: Add TS and JS assertions (reuse the `usesEdges` helper from Phase 2)**

```typescript
test("uses edges (typescript): class->class extends, alias, class->module call", async () => {
  const map = await extract(REPO);
  const u = usesEdges(map);
  expect(u.has("repo.web.child:Child->repo.web.base:Base")).toBe(true); // extends imported (AC2.1)
  expect(u.has("repo.web.aliased:Aliased->repo.web.base:Base")).toBe(true); // alias (AC1.2)
  expect(u.has("repo.web.bar:Bar->repo.web.foo")).toBe(true); // calls imported fn -> module (AC2.2/AC2.4)
});

test("uses edges (javascript): class->class extends imported base", async () => {
  const map = await extract(REPO);
  const u = usesEdges(map);
  expect(u.has("repo.web.circle:Circle->repo.web.shape:Shape")).toBe(true); // JS extends imported (AC2.1)
});
```

**Step 2: Run tests**

Run: `bun test`
Expected: **10 pass, 1 skip, 0 fail** — Phase 2's 7 + Phase 3's always-on allowlist-cause test (1) + these 2 new extract tests = 10 passing; the env-gated differential test stays skipped. Both the TS and JS `uses` tests must pass.

If a TS or JS assertion fails, fix the **TS/JS queries or `jsResolveSymbol`** in
`src/extract/plugins.ts` — never `src/extract/index.ts`.

**Step 3: Prove AC4.1 — no core changes**

Run:
```bash
git diff --name-only HEAD~ -- src/extract/index.ts src/graph/analyze.ts
```
Expected: **empty output** for this phase's commits (neither file changed in
Phase 4). If either appears, you broke the pluggable contract — move the logic
into the plugin.

> AC4.2 (a plugin without `uses` does not error) is already satisfied: any
> structure-only language (e.g. `rust`, `go` in `EXT_LANG`) has no plugin `uses`
> field and pass 2 skips it. No separate test needed, but you may assert that a
> language without a `uses` capability yields no uses edges if a fixture exists.

**Step 4: Commit**

```bash
git add src/extract/plugins.ts tests/fixtures/repo/web/base.ts \
        tests/fixtures/repo/web/child.ts tests/fixtures/repo/web/aliased.ts \
        tests/fixtures/repo/web/shape.js tests/fixtures/repo/web/circle.js \
        tests/extract.test.ts
git commit -m "feat(extract): TS/TSX/JS uses-edge capability + fixtures/tests (orrery-rqj)

Adds uses to the JS-family plugins reusing the engine unchanged (no edits to
index.ts or analyze.ts). TS fixtures cover class->class extends, alias, and
class->module fallback.

Refs: orrery-2uv, orrery-toj"
```
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_B -->

---

## Phase 4 Done When

- `typescript`, `tsx`, and `javascript` plugins all have a working `uses` capability.
- TS **and JS** fixtures exist under `tests/fixtures/repo/web/` (`base.ts`/`child.ts`/`aliased.ts` + `shape.js`/`circle.js`).
- TS and JS `uses`-edge tests pass; full `bun test` shows **10 pass, 1 skip** (differential skipped).
- `git diff` confirms `src/extract/index.ts` and `src/graph/analyze.ts` were **not** changed in this phase (AC4.1).
- All work committed.
