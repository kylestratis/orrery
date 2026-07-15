import { expect, test } from "bun:test";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "../src/render/index.ts";
import type { CodeMap } from "../src/schema.ts";

const MAP: CodeMap = {
  root: "fixture",
  nodes: [
    { id: "fixture", kind: "package" },
    { id: "fixture.a", kind: "module", parent: "fixture" },
    { id: "fixture.a:A", kind: "class", module: "fixture.a" },
  ],
  edges: [],
};

test("render inlines the containment-zoom engine and resolves all markers", () => {
  const out = join(mkdtempSync(join(tmpdir(), "orrery-render-")), "map.html");
  render(MAP, { out });
  const html = readFileSync(out, "utf8");
  expect(html.includes("function buildDisplayGraph")).toBe(true);
  expect(html.includes("<!--{{LAYERS}}-->")).toBe(false);
  expect(html.includes("<!--{{VENDOR}}-->")).toBe(false);
  expect(html.includes("/*{{DATA}}*/ null")).toBe(false);
});
