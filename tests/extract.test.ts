import { expect, test } from "bun:test";
import { join } from "node:path";
import { extract } from "../src/extract/index.ts";

const REPO = join(import.meta.dir, "fixtures", "repo");

const ids = (map: Awaited<ReturnType<typeof extract>>, kind: string) =>
  new Set(map.nodes.filter((n) => n.kind === kind).map((n) => n.id));
const importEdges = (map: Awaited<ReturnType<typeof extract>>) =>
  new Set(map.edges.filter((e) => e.kind === "import").map((e) => `${e.source}->${e.target}`));

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
