import { expect, test } from "bun:test";
import { buildDisplayGraph, nearestVisibleAncestor } from "../src/render/layers.js";

/**
 * Shared test fixtures
 */
const NODES = [
  { id: "app", kind: "package" },
  { id: "app.a", kind: "module", parent: "app" },
  { id: "app.b", kind: "module", parent: "app" },
  { id: "app.empty", kind: "module", parent: "app" }, // module with no classes
  { id: "app.a:A1", kind: "class", module: "app.a" },
  { id: "app.a:A2", kind: "class", module: "app.a" },
  { id: "app.b:B1", kind: "class", module: "app.b" },
];

const EDGES = [
  { source: "app.a:A1", target: "app.b:B1", kind: "uses" }, // cross-file class→class
  { source: "app.a:A2", target: "app.b:B1", kind: "uses" }, // parallel to the above once lifted (dedup)
  { source: "app.a:A1", target: "app.a:A2", kind: "uses" }, // intra-file (self-loop when collapsed)
  { source: "app.a:A1", target: "app.b", kind: "uses" }, // class→module (AC2.4)
  { source: "app.a", target: "app.b", kind: "import" }, // native module→module
  { source: "app.a:A1", target: "app.ghost:X", kind: "uses" }, // unknown target (AC4.2)
];

const ALL_MODULES = new Set(["app.a", "app.b", "app.empty"]);

/**
 * Test helpers
 */
const nodeIds = (g: { nodes: { id: string }[] }) =>
  new Set(g.nodes.map((n) => n.id));

const linkKeys = (g: { links: { source: string; target: string; kind: string }[] }) =>
  new Set(g.links.map((l) => `${l.source}->${l.target}:${l.kind}`));

const find = (
  g: any,
  source: string,
  target: string,
  kind: string
) => g.links.find((l: any) => l.source === source && l.target === target && l.kind === kind);

/**
 * buildDisplayGraph tests (Acceptance Criteria)
 */

test("AC1.1: collapsed state shows only packages and modules, no classes", () => {
  const g = buildDisplayGraph(NODES, EDGES, new Set());
  const ids = nodeIds(g);
  expect(ids).toEqual(new Set(["app", "app.a", "app.b", "app.empty"]));
  // Verify no class nodes
  for (const node of g.nodes) {
    expect(node.kind).not.toBe("class");
  }
});

test("AC1.2: expanded file shows its class nodes with synthesized contains links", () => {
  const g = buildDisplayGraph(NODES, EDGES, new Set(["app.a"]));
  const ids = nodeIds(g);
  expect(ids.has("app.a:A1")).toBe(true);
  expect(ids.has("app.a:A2")).toBe(true);
  expect(ids.has("app.b:B1")).toBe(false);

  const containsA1 = find(g, "app.a", "app.a:A1", "contains");
  const containsA2 = find(g, "app.a", "app.a:A2", "contains");
  expect(containsA1).toBeDefined();
  expect(containsA2).toBeDefined();
  expect(containsA1.lifted).toBe(false);
  expect(containsA2.lifted).toBe(false);

  const containsB1 = find(g, "app.b", "app.b:B1", "contains");
  expect(containsB1).toBeUndefined();
});

test("AC1.3: all modules expanded shows all nodes", () => {
  const g = buildDisplayGraph(NODES, EDGES, ALL_MODULES);
  const ids = nodeIds(g);
  expect(ids).toEqual(
    new Set(["app", "app.a", "app.b", "app.empty", "app.a:A1", "app.a:A2", "app.b:B1"])
  );
});

test("AC1.4: expanding empty module raises no error", () => {
  const g = buildDisplayGraph(NODES, EDGES, new Set(["app.empty"]));
  const ids = nodeIds(g);
  expect(ids).toEqual(new Set(["app", "app.a", "app.b", "app.empty"]));
});

test("AC1.5: packages and modules always present", () => {
  const states = [new Set<string>(), new Set(["app.a"]), ALL_MODULES];
  for (const expanded of states) {
    const g = buildDisplayGraph(NODES, EDGES, expanded);
    const ids = nodeIds(g);
    expect(ids.has("app")).toBe(true);
    expect(ids.has("app.a")).toBe(true);
    expect(ids.has("app.b")).toBe(true);
    expect(ids.has("app.empty")).toBe(true);
  }
});

test("AC2.1: collapsed endpoint lifts class→class edge to file→file", () => {
  const g = buildDisplayGraph(NODES, EDGES, new Set());

  const usesLink = find(g, "app.a", "app.b", "uses");
  expect(usesLink).toBeDefined();
  expect(usesLink.lifted).toBe(true); // three raw uses edges dedup to one, lifted

  const importLink = find(g, "app.a", "app.b", "import");
  expect(importLink).toBeDefined();
  expect(importLink.lifted).toBe(false);

  // Verify exactly one uses link app.a->app.b
  const usesLinks = g.links.filter((l: any) => l.kind === "uses" && l.source === "app.a" && l.target === "app.b");
  expect(usesLinks.length).toBe(1);
});

test("AC2.2: source expanded, target collapsed lifts target endpoint only", () => {
  const g = buildDisplayGraph(NODES, EDGES, new Set(["app.a"]));

  const link1 = find(g, "app.a:A1", "app.b", "uses");
  expect(link1).toBeDefined();
  expect(link1.lifted).toBe(true); // B1's endpoint lifted

  const link2 = find(g, "app.a:A2", "app.b", "uses");
  expect(link2).toBeDefined();
  expect(link2.lifted).toBe(true);

  // Verify no app.a->app.b uses link
  const collapsed = find(g, "app.a", "app.b", "uses");
  expect(collapsed).toBeUndefined();
});

test("AC2.3: both endpoints expanded are native (not lifted)", () => {
  const g = buildDisplayGraph(NODES, EDGES, ALL_MODULES);

  const link1 = find(g, "app.a:A1", "app.b:B1", "uses");
  expect(link1).toBeDefined();
  expect(link1.lifted).toBe(false);

  const link2 = find(g, "app.a:A2", "app.b:B1", "uses");
  expect(link2).toBeDefined();
  expect(link2.lifted).toBe(false);
});

test("AC2.4: class→module edge target never lifts", () => {
  const g = buildDisplayGraph(NODES, EDGES, ALL_MODULES);

  const link = find(g, "app.a:A1", "app.b", "uses");
  expect(link).toBeDefined();
  expect(link.lifted).toBe(false); // target is module, always visible, so not lifted

  // Also verify in collapsed state: same edge contributes to lifted app.a->app.b
  const collapsed = buildDisplayGraph(NODES, EDGES, new Set());
  const collapsedLink = find(collapsed, "app.a", "app.b", "uses");
  expect(collapsedLink).toBeDefined();
  expect(collapsedLink.lifted).toBe(true); // source lifted, but not target
});

test("AC4.1: self-loop dropped (collapsed)", () => {
  const g = buildDisplayGraph(NODES, EDGES, new Set());

  // No self-loop app.a->app.a
  const selfLoop = g.links.find((l: any) => l.source === l.target);
  expect(selfLoop).toBeUndefined();

  const appAtoAppA = find(g, "app.a", "app.a", "uses");
  expect(appAtoAppA).toBeUndefined();
});

test("AC4.1: intra-file edge renders natively when expanded", () => {
  const g = buildDisplayGraph(NODES, EDGES, new Set(["app.a"]));

  const link = find(g, "app.a:A1", "app.a:A2", "uses");
  expect(link).toBeDefined();
  expect(link.lifted).toBe(false);
});

test("AC4.1: parallel edges deduped by key", () => {
  const g = buildDisplayGraph(NODES, EDGES, new Set());

  const usesLinks = g.links.filter(
    (l: any) => l.kind === "uses" && l.source === "app.a" && l.target === "app.b"
  );
  expect(usesLinks.length).toBe(1);
});

test("AC4.2: unknown target dropped", () => {
  const g = buildDisplayGraph(NODES, EDGES, new Set());

  // No link with app.ghost:X as source or target
  const ghostLinks = g.links.filter(
    (l: any) => l.source === "app.ghost:X" || l.target === "app.ghost:X" || l.source === "app.ghost" || l.target === "app.ghost"
  );
  expect(ghostLinks.length).toBe(0);
});

test("AC4.2: unknown target dropped (all expansion states)", () => {
  const states = [new Set<string>(), new Set(["app.a"]), ALL_MODULES];
  for (const expanded of states) {
    const g = buildDisplayGraph(NODES, EDGES, expanded);
    const ghostLinks = g.links.filter(
      (l: any) => l.source === "app.ghost:X" || l.target === "app.ghost:X" || l.source === "app.ghost" || l.target === "app.ghost"
    );
    expect(ghostLinks.length).toBe(0);
  }
});

/**
 * nearestVisibleAncestor unit tests
 */

test("nearestVisibleAncestor: module resolves to itself", () => {
  const nodesById = new Map(NODES.map((n) => [n.id, n]));

  const result = nearestVisibleAncestor("app.a", nodesById, new Set());
  expect(result).toBe("app.a");
});

test("nearestVisibleAncestor: package resolves to itself", () => {
  const nodesById = new Map(NODES.map((n) => [n.id, n]));

  const result = nearestVisibleAncestor("app", nodesById, new Set());
  expect(result).toBe("app");
});

test("nearestVisibleAncestor: class collapsed resolves to module", () => {
  const nodesById = new Map(NODES.map((n) => [n.id, n]));

  const result = nearestVisibleAncestor("app.a:A1", nodesById, new Set());
  expect(result).toBe("app.a");
});

test("nearestVisibleAncestor: class expanded resolves to itself", () => {
  const nodesById = new Map(NODES.map((n) => [n.id, n]));

  const result = nearestVisibleAncestor("app.a:A1", nodesById, new Set(["app.a"]));
  expect(result).toBe("app.a:A1");
});

test("nearestVisibleAncestor: unknown id returns null", () => {
  const nodesById = new Map(NODES.map((n) => [n.id, n]));

  const result = nearestVisibleAncestor("nope", nodesById, new Set());
  expect(result).toBeNull();
});

test("nearestVisibleAncestor: orphan class returns null", () => {
  const orphanNodes = [{ id: "x:Orphan", kind: "class", module: "x.gone" }];
  const nodesById = new Map(orphanNodes.map((n) => [n.id, n]));

  const result = nearestVisibleAncestor("x:Orphan", nodesById, new Set());
  expect(result).toBeNull();
});
