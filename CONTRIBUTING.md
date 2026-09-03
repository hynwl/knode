# Contributing to AgentCanvas

Thanks for considering a contribution. This project is a visual crew builder for
CrewAI: a Next.js canvas talking to a FastAPI backend that compiles the graph into
real `crewai.Crew` objects and streams execution back over SSE. A few things about
this codebase are non-obvious, so read this before opening a PR.

## Setup

Requirements: Node 22+, Python 3.12+, Docker (optional, for the one-click path).

```bash
# frontend
cd frontend
npm ci
npm run dev              # http://localhost:3000

# backend (separate terminal)
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Copy `.env.example` to `.env` if you need to change ports, timeouts, or provider
defaults. API keys are entered in the app UI (Settings → API Keys) and sent as
request headers — never put real keys in `.env` or commit them.

Prefer Docker? See the [README](README.md#quick-start) for `docker compose up`.

## Before you touch CrewAI

**All CrewAI access goes through `backend/app/core/crewai_compat.py`.** Do not
import `crewai` directly anywhere else. CrewAI's public API has drifted from its
own docs multiple times during this project's history — every discrepancy we
found (parameters that don't exist, event payloads that don't carry what you'd
expect, execution paths that block on stdin) is recorded in
[`docs/CREWAI_RECON.md`](docs/CREWAI_RECON.md). If you're changing anything in
`compiler/`, `runtime/`, or `crewai_compat.py`, read it first — assuming the
obvious API shape is how several real bugs got introduced here.

If you bump the pinned `crewai`/`crewai-tools` version in `requirements.txt`,
re-verify the assumptions in `CREWAI_RECON.md` against the new source before
relying on them, and update the doc if anything changed.

## The design lock

`design/reference/artifact-source.html` is the visual source of truth (chmod 444,
read-only). If a spec document and the artifact disagree, the artifact wins. Don't
introduce new colors, spacing, or components that aren't derived from
`design/tokens.ts` — extend the token set instead of hardcoding a value in a
component.

## Drift guards — keep these in sync

Several pairs of files are duplicated by necessity (frontend has no build-time
dependency on the backend, and vice versa) and are held in sync by tests that
fail loudly if you edit one side only:

| Pair | Guarded by |
|---|---|
| `frontend/src/validation/issues.ts` ↔ `backend/app/schemas/errors.py` (`ISSUE_CATALOG`) | `backend/tests/test_schemas.py::test_issue_catalog_matches_frontend` |
| `ISSUE_CATALOG` ↔ `docs/ERRORS.md` | `backend/tests/test_errors_doc.py` |
| CrewAI's actual installed API ↔ `crewai_compat.py` | `backend/tests/test_crewai_compat.py` |

If you add or change an `AC-Exxx` error code: update both catalogs, then
regenerate the docs page —

```bash
backend/.venv/bin/python backend/scripts/gen_errors_doc.py
```

— and commit the result. Don't hand-edit `docs/ERRORS.md`.

## Testing

```bash
# backend
cd backend && .venv/bin/python -m pytest -q

# frontend
cd frontend
npm run typecheck
npm test          # vitest
npm run lint
npm run e2e        # Playwright — spins up its own dev server on port 3100, does not touch your local :3000
```

CI (`.github/workflows/ci.yml`) runs all of the above on every PR.

⚠️ If you have `npm run dev` running locally, **don't** run `npm run build` in
the same checkout — both write to `.next/` by default and the build will corrupt
your dev server's output (it'll start 404ing). `npm run e2e` is safe; it's
isolated via `NEXT_DIST_DIR=.next-e2e` and port 3100.

## Commit / PR conventions

- Conventional-ish prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Keep PRs scoped to one thing. If a fix surfaces while working on something
  else, it's fine to include it, but call it out in the PR description.
- New node types, tools, or providers should go through the registries
  (`frontend/src/nodes/registry.ts`, `backend/app/tools/registry.py`,
  `backend/app/data/model_presets.json`) rather than being special-cased inline —
  that's the single-source-of-truth pattern this codebase leans on throughout.
- No secrets in commits, fixtures, or screenshots. The export path has a secret
  scanner (`frontend/src/persistence/secretScanner.ts`) — if you're adding a new
  field that could plausibly hold a credential, make sure it's covered.

## License

By contributing, you agree your contribution is licensed under the project's
[AGPL-3.0](LICENSE).
