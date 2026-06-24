import { expect, test } from "bun:test";
import { join } from "node:path";
import { extract } from "../src/extract/index.ts";

const REPO = join(import.meta.dir, "fixtures", "repo");

const ids = (map: Awaited<ReturnType<typeof extract>>, kind: string) =>
  new Set(map.nodes.filter((n) => n.kind === kind).map((n) => n.id));
const importEdges = (map: Awaited<ReturnType<typeof extract>>) =>
  new Set(map.edges.filter((e) => e.kind === "import").map((e) => `${e.source}->${e.target}`));
const usesEdges = (map: Awaited<ReturnType<typeof extract>>) =>
  new Set(map.edges.filter((e) => e.kind === "uses").map((e) => `${e.source}->${e.target}`));

test("structure + class nodes across languages", async () => {
  const map = await extract(REPO);
  expect(map.root).toBe("repo");
  const mods = ids(map, "module");
  expect(mods.has("repo.pkg.base")).toBe(true);
  expect(mods.has("repo.web.bar")).toBe(true);
  const classes = ids(map, "class");
  expect(classes.has("repo.pkg.base:Base")).toBe(true);
  expect(classes.has("repo.pkg.impl:Impl")).toBe(true);
  expect(classes.has("repo.web.bar:Bar")).toBe(true);
});

test("import edges resolve intra-repo (python relative + ts relative)", async () => {
  const map = await extract(REPO);
  const e = importEdges(map);
  expect(e.has("repo.pkg.impl->repo.pkg.base")).toBe(true); // python `from .base`
  expect(e.has("repo.web.bar->repo.web.foo")).toBe(true); // ts `./foo`
  // external/stdlib imports must not produce edges
  expect([...e].some((s) => s.includes("os"))).toBe(false);
});

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
