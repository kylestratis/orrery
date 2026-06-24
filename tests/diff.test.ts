import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extract } from "../src/extract/index.ts";

const PROTOTYPE = process.env.ORRERY_DIFF_PROTOTYPE;
const REPO = process.env.ORRERY_DIFF_REPO;
const PYTHON = process.env.ORRERY_DIFF_PYTHON ?? "python3";
const ALLOWLIST_PATH =
  process.env.ORRERY_DIFF_ALLOWLIST ?? join(import.meta.dir, "diff-allowlist.json");

const enabled = Boolean(PROTOTYPE && REPO);

interface Allow {
  onlyOrrery: { edge: string; cause: string }[];
  onlyPrototype: { edge: string; cause: string }[];
}

async function prototypeUsesEdges(): Promise<Set<string>> {
  const proc = Bun.spawn([PYTHON, PROTOTYPE!, REPO!], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`reference prototype exited ${code}: ${err}`);
  }
  // Expected: JSON array of { source, target } uses edges using orrery id conventions.
  const parsed = JSON.parse(out) as { source: string; target: string }[];
  return new Set(parsed.map((e) => `${e.source}->${e.target}`));
}

test.skipIf(!enabled)("python uses edges match the reference prototype (AC5)", async () => {
  const allow = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as Allow;
  const allowOnlyOrrery = new Set(allow.onlyOrrery.map((a) => a.edge));
  const allowOnlyPrototype = new Set(allow.onlyPrototype.map((a) => a.edge));
  // AC5.2: every allowlist entry must carry a non-empty cause.
  for (const a of [...allow.onlyOrrery, ...allow.onlyPrototype]) {
    expect(a.cause.trim().length).toBeGreaterThan(0);
  }

  const map = await extract(REPO!);
  const orrery = new Set(
    map.edges.filter((e) => e.kind === "uses").map((e) => `${e.source}->${e.target}`),
  );
  const proto = await prototypeUsesEdges();

  const onlyOrrery = [...orrery].filter((e) => !proto.has(e) && !allowOnlyOrrery.has(e));
  const onlyPrototype = [...proto].filter((e) => !orrery.has(e) && !allowOnlyPrototype.has(e));

  // AC5.1: set-equality modulo the documented allowlist.
  expect({ onlyOrrery, onlyPrototype }).toEqual({ onlyOrrery: [], onlyPrototype: [] });
});

test("diff allowlist entries all carry a cause", () => {
  const allow = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as Allow;
  for (const a of [...allow.onlyOrrery, ...allow.onlyPrototype]) {
    expect(typeof a.cause).toBe("string");
    expect(a.cause.trim().length).toBeGreaterThan(0);
  }
});
