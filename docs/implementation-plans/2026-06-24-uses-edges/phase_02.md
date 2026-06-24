# `uses` Edges — Phase 2: Generic engine + Python capability

**Goal:** Implement the language-agnostic pass-2 `uses` engine in the orchestrator, plus the Python `UsesCapability` that proves it end-to-end.

**Scope:** Phase 2 of 5. Depends on Phase 1.

**Codebase verified:** 2026-06-24.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### uses-edges.AC1: Per-module symbol table maps local names to node ids
- **uses-edges.AC1.1 Success:** A plain import (`import a.b`) binds the local name to the resolved module node id.
- **uses-edges.AC1.2 Success:** An aliased import (`import a.b as c` / `import {x as y}`) binds the **alias** to the target node id.
- **uses-edges.AC1.3 Success:** A `from`-style import of a class (`from .base import Base`) binds the local name to the **class** node id (`module:Base`), not the module.
- **uses-edges.AC1.4 Success:** A same-module top-level class is present in the table mapped to its own class node id.
- **uses-edges.AC1.5 Failure:** An external/stdlib import (`import os`, bare specifier) resolves to null and adds no table entry.

### uses-edges.AC2: Class references resolve into uses edges (Python)
- **uses-edges.AC2.1 Success (class→class):** A class extending/subclassing an imported class emits a `uses` edge to that class node.
- **uses-edges.AC2.2 Success (class→module fallback):** A class referencing an imported module-level function/constant emits a `uses` edge to the **module** node.
- **uses-edges.AC2.3 Success (same-module):** A class referencing another top-level class in its own module emits a `uses` edge to that class node.
- **uses-edges.AC2.4 Edge:** The root of an attribute/member chain is the referenced name (`a.b.c` ⇒ `a`); the property names do **not** produce edges.
- **uses-edges.AC2.5 Edge:** Duplicate references within one class produce a single deduped edge.

### uses-edges.AC3: Exclusions match the prototype
- **uses-edges.AC3.1 Failure (self):** A class referencing its own name emits no `uses` edge.
- **uses-edges.AC3.2 Failure (own-module):** A reference that resolves only to the class's own module emits no `uses` edge.
- **uses-edges.AC3.3 Failure (unresolved):** A reference with no symbol-table entry emits no edge.

### uses-edges.AC8.1: Per-language fixtures (Python)
- **uses-edges.AC8.1 Success:** `tests/fixtures/repo` Python fixtures cover symbol-table + reference resolution (class→class, class→module, same-module, alias, exclusion).

---

## Background the engineer needs

**Why two passes.** A `uses` edge can point at a class defined in *another* file (e.g. `from .base import Base`). So the engine must finish discovering **all** class nodes (and thus the global `classIds` set from Phase 1) before it can resolve references. Pass 1 = today's structure/import/class walk (now also filling `classIds`). Pass 2 = uses extraction, run only for files whose plugin defines `uses`.

**tree-sitter API (web-tree-sitter 0.22.6), already used in this file:**
- `parsed.lang.query(srcString)` returns a `Query`.
- `query.captures(node)` → flat `{ name, node }[]` in document order. Used today at `index.ts:103`.
- `query.matches(node)` → `{ pattern, captures: { name, node }[] }[]`, grouping captures that matched together. **Use this for `symbolQuery`** so each import's `@sym.local`/`@sym.src`/`@sym.name` stay associated.
- A `SyntaxNode` exposes `.text`, `.parent`, `.startIndex`, `.endIndex` (byte offsets). The engine uses positions for `@skip` subtraction and `.parent` span for enclosing-class scoping — never a node *type*.

**Enclosing-class scoping, generically.** The `referenceQuery` captures each class's **name** node as `@def.class`. The class-definition node is that name node's `.parent`, whose `[startIndex, endIndex]` span covers the whole class body. A `@ref` belongs to the innermost class span that contains it. This needs zero grammar-type knowledge.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Pass 1 fills `classIds`; restructure `extract()` for two passes

**Files:**
- Modify: `src/extract/index.ts`

**Step 1: Populate `classIds` during class registration (pass 1)**

In the existing capture loop, class registration currently reads (lines 109–114):

```typescript
      if (cap.name === "def.class") {
        const cid = `${file.id}:${cap.node.text}`;
        if (!classSeen.has(cid)) {
          classSeen.add(cid);
          nodes.push({ id: cid, kind: "class", parent: file.id, module: file.id, lang: file.lang });
        }
      } else {
```

Change it to also record the class id:

```typescript
      if (cap.name === "def.class") {
        const cid = `${file.id}:${cap.node.text}`;
        if (!classSeen.has(cid)) {
          classSeen.add(cid);
          classIds.add(cid);
          nodes.push({ id: cid, kind: "class", parent: file.id, module: file.id, lang: file.lang });
        }
      } else {
```

**Step 2: Make the import-edge dedup key kind-aware**

So import and uses edges never collide in `edgeSeen`, change the import dedup (lines 119–123) from:

```typescript
          const key = `${file.id}|${target}`;
          if (!edgeSeen.has(key)) {
            edgeSeen.add(key);
            edges.push({ source: file.id, target, kind: "import" });
          }
```

to:

```typescript
          const key = `${file.id}|${target}|import`;
          if (!edgeSeen.has(key)) {
            edgeSeen.add(key);
            edges.push({ source: file.id, target, kind: "import" });
          }
```

(This matches the `${source}|${target}|${kind}` convention already used by `mergeCodeMaps` in `src/schema.ts:64`.)

**Step 3: Verify pass 1 unchanged in behavior**

Run: `bun test`
Expected: **5 pass / 0 fail** (still no `uses` edges yet — pass 2 added in Task 2).

**No commit yet** — commit at the end of Subcomponent A (Task 2) once the engine is in.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add the generic pass-2 `uses` engine

**Files:**
- Modify: `src/extract/index.ts`

**Step 1: Add a position-based enclosing-class helper**

Add this module-level helper near `dottedId` (top of `src/extract/index.ts`):

```typescript
/** Innermost class span containing [start,end], or null. `classSpans` are the
 *  class-definition node ranges paired with their class node id. */
function enclosingClass(
  start: number,
  end: number,
  classSpans: { start: number; end: number; id: string }[],
): string | null {
  let best: string | null = null;
  let bestSpan = Infinity;
  for (const c of classSpans) {
    if (c.start <= start && end <= c.end) {
      const span = c.end - c.start;
      if (span < bestSpan) {
        bestSpan = span;
        best = c.id;
      }
    }
  }
  return best;
}
```

**Step 2: Add pass 2 after the existing pass-1 loop**

Pass 1 ends at the closing brace of the `for (const file of sources)` loop (line 127), right before `return { root, nodes, edges };`. Insert this **second** loop there:

```typescript
  // --- Pass 2: uses edges (only for files whose plugin defines `uses`) -------
  for (const file of sources) {
    const plugin = pluginFor(file.lang);
    if (!plugin?.uses) continue;
    let source: string;
    try {
      source = readFileSync(join(repoPath, file.path), "utf8");
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = await parse(plugin.grammar, source);
    } catch {
      continue;
    }
    const ctx = { importerId: file.id, importerPath: file.path, ids, pathToId, classIds };

    // 1. Build the per-module symbol table: localName -> intra-repo node id.
    const table = new Map<string, string>();
    // same-module top-level classes (generic: by module ownership)
    for (const n of nodes) {
      if (n.kind === "class" && n.module === file.id) {
        table.set(n.id.slice(file.id.length + 1), n.id);
      }
    }
    // imports (matches() groups each import's captures together)
    let symMatches;
    try {
      symMatches = parsed.lang.query(plugin.uses.symbolQuery).matches(parsed.root);
    } catch {
      symMatches = [];
    }
    for (const m of symMatches) {
      let local = "";
      let spec = "";
      let name: string | null = null;
      for (const c of m.captures) {
        if (c.name === "sym.local") local = c.node.text;
        else if (c.name === "sym.src") spec = c.node.text;
        else if (c.name === "sym.name") name = c.node.text;
      }
      if (!local || !spec) continue;
      const target = plugin.uses.resolveSymbol(stripQuotes(spec), name, ctx);
      if (target) table.set(local, target);
    }

    // 2. Scope references to their enclosing class.
    let refCaps;
    try {
      refCaps = parsed.lang.query(plugin.uses.referenceQuery).captures(parsed.root);
    } catch {
      refCaps = [];
    }
    const classSpans: { start: number; end: number; id: string }[] = [];
    const skip = new Set<string>();
    for (const cap of refCaps) {
      if (cap.name === "def.class") {
        const def = cap.node.parent ?? cap.node; // class-definition node spans the body
        classSpans.push({ start: def.startIndex, end: def.endIndex, id: `${file.id}:${cap.node.text}` });
      } else if (cap.name === "skip") {
        skip.add(`${cap.node.startIndex}:${cap.node.endIndex}`);
      }
    }

    // 3. Resolve, filter, emit.
    for (const cap of refCaps) {
      if (cap.name !== "ref") continue;
      if (skip.has(`${cap.node.startIndex}:${cap.node.endIndex}`)) continue;
      const owner = enclosingClass(cap.node.startIndex, cap.node.endIndex, classSpans);
      if (!owner) continue;
      const target = table.get(cap.node.text);
      if (!target) continue; // unresolved (AC3.3)
      if (target === owner) continue; // self (AC3.1)
      if (target === file.id) continue; // own-module-only (AC3.2)
      const key = `${owner}|${target}|uses`;
      if (!edgeSeen.has(key)) {
        edgeSeen.add(key); // dedup within a class (AC2.5)
        edges.push({ source: owner, target, kind: "uses" });
      }
    }
  }

  return { root, nodes, edges };
```

> Replace the existing final `return { root, nodes, edges };` with the version at the end of the inserted block (do not leave two returns).

**Step 3: Verify the engine is inert without a `uses` capability**

At this point no plugin defines `uses` yet, so pass 2 runs zero iterations.

Run: `bun test`
Expected: **5 pass / 0 fail** (still no `uses` edges — proves the engine is additive and a plugin without `uses` does not error; partial `uses-edges.AC4.2`, completed in Phase 4).

**Step 4: Commit (Subcomponent A complete)**

```bash
git add src/extract/index.ts
git commit -m "feat(extract): generic two-pass uses-edge engine (orrery-31p)

Pass 1 now fills classIds and uses kind-aware dedup keys. Pass 2 builds a
per-file symbol table, scopes @ref to its enclosing class by position, applies
self/own-module exclusions, and emits deduped uses edges. Language-agnostic:
no grammar node types referenced. Inert until a plugin defines uses.

Refs: orrery-2uv, orrery-toj"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: Add the Python `UsesCapability`

**Files:**
- Modify: `src/extract/plugins.ts`

**Step 1: Add `resolveSymbol` for Python (class-preferred, module fallback)**

Add this helper near `pyResolve` in `src/extract/plugins.ts`:

```typescript
/** Resolve an imported binding to a node id: prefer the class, then a submodule,
 *  then the module. Mirrors the prototype's class → submodule → module order. */
function pyResolveSymbol(spec: string, name: string | null, ctx: ResolveCtx): string | null {
  const mod = pyResolve(spec, ctx); // module/package id, or null for external
  if (name) {
    if (mod) {
      const classId = `${mod}:${name}`;
      if (ctx.classIds.has(classId)) return classId; // from MOD import Class
    }
    // from . import submodule  /  from pkg import submodule
    const joined = spec.endsWith(".") ? `${spec}${name}` : `${spec}.${name}`;
    const sub = pyResolve(joined, ctx);
    if (sub) return sub;
  }
  return mod; // module fallback (or null)
}
```

**Step 2: Add the `uses` capability to the `python` plugin**

The `python` plugin is currently (lines 50–59) `{ grammar, query, resolveImport }`. Add a `uses` field. Insert these query constants above the `python` object and wire them in:

```typescript
const PY_SYMBOL_QUERY = `
  ; import a.b.c            -> local = first segment, src = full dotted path
  (import_statement (dotted_name . (identifier) @sym.local) @sym.src)
  ; import a.b.c as x       -> local = alias
  (import_statement (aliased_import name: (dotted_name) @sym.src alias: (identifier) @sym.local))
  ; from .mod import Name [as Local]
  (import_from_statement
    module_name: (_) @sym.src
    name: (dotted_name (identifier) @sym.name @sym.local))
  (import_from_statement
    module_name: (_) @sym.src
    name: (aliased_import name: (dotted_name (identifier) @sym.name) alias: (identifier) @sym.local))
`;

const PY_REFERENCE_QUERY = `
  ; class names (for enclosing-class scoping)
  (class_definition name: (identifier) @def.class)
  ; attribute property names are NOT references (the chain root is) -> skip them
  (attribute attribute: (identifier) @skip)
  ; every load identifier is a candidate; the symbol table is the real filter
  (identifier) @ref
`;
```

Then change the `python` plugin object to include `uses`:

```typescript
const python: Plugin = {
  grammar: "python",
  query: `
    (import_statement (dotted_name) @imp.abs)
    (import_statement (aliased_import (dotted_name) @imp.abs))
    (import_from_statement module_name: (_) @imp.from)
    (class_definition name: (identifier) @def.class)
  `,
  resolveImport: pyResolve,
  uses: {
    symbolQuery: PY_SYMBOL_QUERY,
    referenceQuery: PY_REFERENCE_QUERY,
    resolveSymbol: pyResolveSymbol,
  },
};
```

> **Important — queries may need iteration.** tree-sitter query syntax for Python imports is fiddly (repeated `name:` fields, relative-dot module names). The queries above are a correct-by-design starting point; the **fixture tests in Task 5 are the authoritative spec.** If a fixture assertion fails, adjust the query (not the engine) until it passes. Use `parsed.lang.query(q).matches(root)` in a scratch script to inspect captures if needed. Do **not** add node-type knowledge to `index.ts`.

**Step 2 note (capture semantics):** `@sym.name` and `@sym.local` on the same node (the `from X import Name` case) is intentional — local binding equals the imported leaf unless aliased. The engine reads `@sym.local` for the table key and `@sym.name` for class-preference in `resolveSymbol`.

**Step 3: Verify nothing breaks yet**

Run: `bun test`
Expected: **5 pass / 0 fail** (fixtures/tests come in Tasks 4–5; existing tests must stay green).

**No commit yet** — commit after the fixtures + tests pass (Task 5).
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Add Python fixtures exercising every resolution path

**Files:**
- Create: `tests/fixtures/repo/pkg/helpers.py`
- Create: `tests/fixtures/repo/pkg/service.py`
- Create: `tests/fixtures/repo/pkg/aliased.py`
- Create: `tests/fixtures/repo/pkg/solo.py`

These are **additive** — existing fixture files (`pkg/base.py`, `pkg/impl.py`, `web/*.ts`) stay unchanged, and existing tests assert membership (`.has(...)`), so new nodes/edges won't break them.

**Step 1: `tests/fixtures/repo/pkg/helpers.py`** (a module with no class — module-fallback target)

```python
def helper():
    return 1

CONST = 2
```

**Step 2: `tests/fixtures/repo/pkg/service.py`** (class→class imported base, class→module fallback, same-module class→class)

```python
from .base import Base
from . import helpers
import os


class Service(Base):
    def run(self):
        return helpers.helper()


class Worker:
    def go(self):
        return Service()
```

Expected `uses` edges:
- `repo.pkg.service:Service -> repo.pkg.base:Base` (class→class, AC2.1)
- `repo.pkg.service:Service -> repo.pkg.helpers` (class→module fallback, AC2.2 — `helpers` is a module, `helpers.helper` attribute root is `helpers`, AC2.4)
- `repo.pkg.service:Worker -> repo.pkg.service:Service` (same-module class→class, AC2.3, AC1.4)
- **No** edge for `os` (external, AC1.5) and **no** edge for `self` (param, unresolved, AC3.3).

**Step 3: `tests/fixtures/repo/pkg/aliased.py`** (aliased class import, AC1.2/AC1.3)

```python
from .base import Base as B


class Child(B):
    pass
```

Expected: `repo.pkg.aliased:Child -> repo.pkg.base:Base`.

**Step 4: `tests/fixtures/repo/pkg/solo.py`** (self + unresolved exclusions, AC3.1/AC3.3)

```python
def util():
    return 1


class Solo:
    def m(self):
        x = Solo
        y = util()
        return (x, y)
```

Expected: **no** `uses` edges out of `Solo` — `Solo` is self (AC3.1); `util` is a same-module *function* (not in the table, which holds only same-module classes + imports) so it is unresolved (AC3.3); `x`, `y`, `self` are locals/params (unresolved).

> This `util()` case also demonstrates that same-module functions do not leak edges. The explicit `target === file.id` own-module guard (AC3.2) is additionally exercised by the Phase 3 differential test against the reference prototype.

**No commit yet** — commit with the tests in Task 5.
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Add Python `uses`-edge tests

**Verifies:** uses-edges.AC1.1, AC1.2, AC1.3, AC1.4, AC1.5, AC2.1, AC2.2, AC2.3, AC2.4, AC2.5, AC3.1, AC3.3, AC8.1

**Files:**
- Modify: `tests/extract.test.ts`

**Step 1: Add a `usesEdges` helper and tests**

`tests/extract.test.ts` already defines `ids(...)` and `importEdges(...)` helpers (lines 7–10). Add a `usesEdges` helper mirroring `importEdges`, then add the tests below. Follow the existing `bun:test` style (`import { expect, test } from "bun:test"`, top-level `test(...)`, `.toBe(...)`):

```typescript
const usesEdges = (map: Awaited<ReturnType<typeof extract>>) =>
  new Set(map.edges.filter((e) => e.kind === "uses").map((e) => `${e.source}->${e.target}`));

test("uses edges (python): class->class, class->module, same-module, alias", async () => {
  const map = await extract(REPO);
  const u = usesEdges(map);
  expect(u.has("repo.pkg.impl:Impl->repo.pkg.base:Base")).toBe(true); // imported base (AC2.1)
  expect(u.has("repo.pkg.service:Service->repo.pkg.base:Base")).toBe(true); // imported base (AC2.1)
  expect(u.has("repo.pkg.service:Service->repo.pkg.helpers")).toBe(true); // module fallback (AC2.2/AC2.4)
  expect(u.has("repo.pkg.service:Worker->repo.pkg.service:Service")).toBe(true); // same-module (AC2.3/AC1.4)
  expect(u.has("repo.pkg.aliased:Child->repo.pkg.base:Base")).toBe(true); // alias (AC1.2/AC1.3)
});

test("uses edges (python): exclusions and dedup", async () => {
  const map = await extract(REPO);
  const u = usesEdges(map);
  // self-reference produces no edge (AC3.1)
  expect(u.has("repo.pkg.solo:Solo->repo.pkg.solo:Solo")).toBe(false);
  // external/stdlib and unresolved names produce no edges (AC1.5/AC3.3)
  expect([...u].some((s) => s.includes("os"))).toBe(false);
  expect([...u].some((s) => s.includes("util"))).toBe(false);
  expect([...u].some((s) => s.includes("self"))).toBe(false);
  // no class points a uses edge at its own module (AC3.2 spirit)
  expect(u.has("repo.pkg.service:Service->repo.pkg.service")).toBe(false);
  // dedup: at most one edge per (source,target) pair (AC2.5)
  const list = map.edges.filter((e) => e.kind === "uses").map((e) => `${e.source}->${e.target}`);
  expect(list.length).toBe(new Set(list).size);
});
```

**Step 2: Run the tests; iterate the Python queries until green**

Run: `bun test`
Expected: **7 pass / 0 fail** (the original 5 + 2 new).

If a `uses` assertion fails, the fix is in the **Python queries / `resolveSymbol`** in `src/extract/plugins.ts` (Task 3), never in `src/extract/index.ts`. Common adjustments:
- The `from X import Name` pattern may need the `name:` field shape tweaked for the installed `tree-sitter-python` grammar — inspect with a scratch `matches()` dump.
- If `import a.b` over- or under-binds, revisit the `. (identifier)` first-segment anchor.

**Step 3: Commit (Subcomponent B complete)**

```bash
git add src/extract/plugins.ts tests/fixtures/repo/pkg/helpers.py \
        tests/fixtures/repo/pkg/service.py tests/fixtures/repo/pkg/aliased.py \
        tests/fixtures/repo/pkg/solo.py tests/extract.test.ts
git commit -m "feat(extract): python uses-edge capability + fixtures/tests (orrery-31p)

Python symbolQuery/referenceQuery + class-preferred resolveSymbol. Fixtures and
tests cover class->class, class->module fallback, same-module, alias, and
self/external/unresolved exclusions. 7 tests pass.

Refs: orrery-2uv, orrery-toj"
```
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

---

## Phase 2 Done When

- `src/extract/index.ts` has a generic pass-2 engine that references no grammar node types.
- `src/extract/plugins.ts` `python` plugin has a working `uses` capability.
- New Python fixtures exist under `tests/fixtures/repo/pkg/`.
- `bun test` shows **7 pass / 0 fail**.
- All work committed.
