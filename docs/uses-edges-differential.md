# Python `uses`-edge differential gate

`tests/diff.test.ts` checks that orrery's Python `uses` edges match a validated
external **reference prototype** on a **reference repo**. Both are supplied at
run time via environment variables and are **never committed** (they may be
proprietary):

- `ORRERY_DIFF_PROTOTYPE` — path to the prototype script, run as `python <path> <repo>`.
  It must print a JSON array of `{ "source", "target" }` `uses` edges using
  orrery's id convention (`repo.pkg.mod`, `repo.pkg.mod:Class`).
- `ORRERY_DIFF_REPO` — path to the repo to extract.
- `ORRERY_DIFF_PYTHON` — interpreter (default `python3`).
- `ORRERY_DIFF_ALLOWLIST` — allowlist path (default `tests/diff-allowlist.json`).

When the prototype/repo vars are unset, the differential test **skips**.

## Run

    ORRERY_DIFF_PROTOTYPE=/abs/prototype.py \
    ORRERY_DIFF_REPO=/abs/reference-repo \
    bun test tests/diff.test.ts

## Allowlist

`tests/diff-allowlist.json` records edges that may legitimately differ between
the two extractors, each with a written **cause**. The most common cause is the
**load-vs-store approximation**: tree-sitter queries cannot distinguish a name
being read from one being assigned, so orrery may over-emit relative to an
AST-based prototype. Every entry requires a non-empty `cause`; a committed
causeless entry fails the test suite.
