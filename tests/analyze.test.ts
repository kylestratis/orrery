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

test("uses edges feed PageRank centrality (AC6.1)", () => {
  // 'lib:Helper' is depended on ONLY via a uses edge; it must outrank the dependent 'app:App'.
  const map: CodeMap = {
    root: "repo",
    nodes: [
      { id: "app:App", kind: "class" },
      { id: "lib:Helper", kind: "class" },
    ],
    edges: [{ source: "app:App", target: "lib:Helper", kind: "uses" }],
  };
  augment(map);
  const helper = map.nodes.find((n) => n.id === "lib:Helper")!;
  const app = map.nodes.find((n) => n.id === "app:App")!;
  // A node depended on via uses edge should have higher centrality than the dependent
  expect(helper.score).toBeGreaterThan(app.score!);
});

test("uses edges do not create cycle annotations (AC6.2)", () => {
  // A mutual uses relationship would be a cycle IF uses fed SCC — it must not.
  const map: CodeMap = {
    root: "repo",
    nodes: [
      { id: "a:A", kind: "class" },
      { id: "b:B", kind: "class" },
    ],
    edges: [
      { source: "a:A", target: "b:B", kind: "uses" },
      { source: "b:B", target: "a:A", kind: "uses" },
    ],
  };
  augment(map);
  expect(map.nodes.every((n) => n.cycle === undefined)).toBe(true);
});
