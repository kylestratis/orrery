import { expect, test } from "bun:test";
import { pagerank, sccs, augment } from "../src/graph/analyze.ts";
import type { CodeMap } from "../src/schema.ts";

test("pagerank ranks a depended-on node highest", () => {
  const r = pagerank(["a", "b", "c"], [["a", "b"], ["c", "b"]]);
  expect(r.get("b")!).toBeGreaterThan(r.get("a")!);
  expect(r.get("b")!).toBeGreaterThan(r.get("c")!);
});

test("sccs finds a single cycle", () => {
  const comps = sccs([["a", "b"], ["b", "c"], ["c", "a"], ["c", "d"]]);
  const nontrivial = comps.filter((c) => c.size > 1);
  expect(nontrivial.length).toBe(1);
  expect([...nontrivial[0]!].sort()).toEqual(["a", "b", "c"]);
});

test("augment annotates score and cycle", () => {
  const map: CodeMap = {
    root: "x",
    nodes: [
      { id: "x.a", kind: "module" },
      { id: "x.b", kind: "module" },
      { id: "x.c", kind: "module" },
    ],
    edges: [
      { source: "x.a", target: "x.b", kind: "import" },
      { source: "x.b", target: "x.a", kind: "import" }, // cycle a<->b
      { source: "x.c", target: "x.b", kind: "import" },
    ],
  };
  augment(map);
  const byId = Object.fromEntries(map.nodes.map((n) => [n.id, n]));
  expect(typeof byId["x.b"]!.score).toBe("number");
  expect(byId["x.a"]!.cycle).toBeDefined();
  expect(byId["x.b"]!.cycle).toBe(byId["x.a"]!.cycle);
});
