# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **v0.1:** the offline core of a Jev-powered, turn-level output-quality guardrail for coding agents.
- `parseRubric` - validate a committed, readable rubric where each rule is one narrow yes/no question with a `repairAt` / `noteAt` band, optional `scope`, and `source` provenance.
- Pure engine: `questionsForFile` (batches one Noul per in-scope rule), `findingsForFile` (bands the answers), and the **ratchet** (`fingerprint`, `newFindings`, `baselineFrom`) so only newly introduced violations are flagged and the baseline can only shrink.
- `checkTurn` - one batched Jev call per changed file, banded and ratcheted; driven by the shared `JevProvider` port (`providerFromEnv` fails open with no key, honors `TYPESAFE_AI_BASE_URL`).
- `leash` CLI: `report`, `audit`, `check`. Always exits 0 (advisory, never breaks a session).
- Foundry TS gate: prettier, eslint (max-len), knip, tsc strict, vitest.
- **v0.2:** Claude Code turn hook. `stopDecision` blocks a turn only on a repair-band break (the agent fixes it in the same turn), `leash snapshot` records the pre-turn tree (`git stash create`) so the check sees only this turn, `leash hook` is the Stop handler, and `leash init` / `uninstall` wire both hooks into a Claude Code `settings.json` idempotently.
- **v0.3:** `leash compile` validates the rubric and reports the deterministic-first split; a new optional per-rule `handledBy` defers a rule to a named deterministic tool (the engine skips it, so Jev is spent only where nothing else can decide). `leash guard <baseRef>` is a hard check that fails when the rubric is loosened (a rule removed, a band threshold raised, or a rule newly deferred). The agent authors the rubric from `CLAUDE.md` with no second model; see [docs/COMPILE.md](docs/COMPILE.md).

### Roadmap

- `calibrate` the rubric against git history; opt-in edit-phase checks; Codex / OpenCode hook adapters.
