# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`leash calibrate --from thresholds.json`**: writes each rule's `repairAt`/`noteAt` from a jev-eval measurement (its `yesAt` section, jev-eval 1.2.0). The strictest precision target's threshold becomes `repairAt`, the loosest `noteAt`; a single target sets `repairAt` only. Refuses non-version-1 files, warns on a model mismatch and on a question reworded since it was measured. `--dry-run` prints without writing. New exports: `parseYesAtThresholds`, `planBands`, `applyBands`, `wireQuestion`.

## [0.16.0] - 2026-10-10

### Added

- **`leash audit --all [paths...]`** judges whole files as if just written, so existing debt in files no diff touches can be baselined (the spec's `audit <paths>`).
- `leash check` lists findings the baseline hides as `[baselined]`, so a fresh break of an accepted rule in an accepted file is still visible to a person.
- `leash compile` warns when a scope glob matches no file in the repo (often a root-only `*.ts` meant as `**/*.ts`). New export: `deadScopes`.
- **Codex per-edit checks.** Codex's `Edit|Write` matcher catches `apply_patch`, but its payload has the patch text instead of a file path, so the edit hook skipped every Codex edit. It now judges each file the patch adds, updates or moves to. New export: `editedFiles`.

### Fixed

- Turn state (snapshot and block record) is kept per session (`session_id`), so two agent sessions in one checkout no longer reset each other's turn. Stale per-session files are pruned after a week.
- When Codex re-submits Leash's block reason as a prompt, the snapshot is kept, so the repair is judged against the turn's real start.
- Hooks move to the repo of the payload's `cwd`, and Codex patch paths resolve against it.
- Building the snapshot tree is capped at 25s, so a huge untracked tree fails with a logged miss before the host's 30s kill.
- Running a hook by hand at a terminal no longer waits for stdin.
- On Windows, `leash login` restricts `~/.leash/.env` to the current user with `icacls`; on Git Bash it explains that input can't be hidden there.

## [0.15.0] - 2026-10-10

### Changed

- **Jev client from `@cmaintz/jev-core`.** `src/provider.ts` is now a thin layer over the published client instead of its own copy, keeping Leash's exports, the 20 s default timeout, `LEASH_TIMEOUT_MS` and the turn-deadline `signal`. Errors are now `JevError` subclasses (same messages), and malformed answers are dropped as "no answer" instead of passed through. First runtime dependency; requires Node 20.3 or newer.
- One judging pipeline: the per-edit check and `calibrate` now go through `checkTurn` (new `phase` option), so they get the same ignore list, binary skip, chunking and deadline as the turn check. A failed call in `calibrate` skips that file instead of aborting the run.
- The CLI is split by job: `cli-turn.ts` (check, audit, hooks), `cli-rubric.ts` (compile, report, guard, session), `cli-setup.ts` (login, init, uninstall); `cli.ts` only dispatches. `leash help` lists every command.
- The turn deadline counts from process start, and reading the hook payload gives up after 5s, so a stdin that never closes can't eat the budget.

### Fixed

- `check --json` printed nothing but a stderr line for an invalid rubric; it now always prints the JSON result (`ran: false`).
- A tracked edit of the same size made within a second of the last index write could be missed by the turn snapshot: the scratch index copy got a fresh mtime, which defeats git's racy-entry check. The copy now keeps the real index's mtime.

### Tests

- Spawn-level CLI tests run the built binary in a throwaway repo against a mock Jev server: the hook's block output and exit 0, fail-open with no key or a dead server, subdirectory sessions, `guard` on a deleted rubric, `init` on a broken settings file, and `check --json` on a broken rubric.

## [0.14.2] - 2026-10-10

### Fixed

- `leash guard` passed when the rubric was deleted or invalid, and missed rules narrowed in scope, moved to the edit phase, or reworded. All now fail, and so does a baseline that gained entries (`baselineGrowth`).
- The Stop hook and `check --turn` use the rubric and baseline from the turn's snapshot, so an agent editing either mid-turn can't weaken its own check. A corrupt baseline counts as empty.
- `audit` overwrote the whole baseline: on a clean tree it emptied it, and files whose call failed lost their entries. It now refreshes only the files it judged (`rebaseline`).
- `init` replaced a settings file it couldn't parse with Leash's hooks alone. It now stops and changes nothing. `uninstall` crashed on prompt-type hooks and removed whole hook groups; it now removes only Leash's hooks.
- Sessions started in a subdirectory found no rubric and skipped every check silently. Leash now runs from the repo root.
- Scope globs support `{a,b}` and `?`; `src/**/*.{ts,tsx}` used to match nothing.
- `init`, `uninstall`, `login`, `compile` and `guard` exit 1 on an error; hook and check paths still always exit 0.

## [0.14.1] - 2026-10-10

### Security

- A repo's `.env`/`.env.local` can no longer set `TYPESAFE_AI_BASE_URL`, `JEV_PROVIDER` or `CLOUDFLARE_ACCOUNT_ID`. A committed `.env` could otherwise send the user's key (from `~/.leash/.env`) and every changed file to any server. Repo files may still set `JEV_API_KEY`, `JEV_MODEL` and `LEASH_*`. `envFiles` now returns `{ path, repo }` entries.
- Git runs through `execFileSync` with argument arrays everywhere, so a file name, ref or snapshot marker can no longer inject a shell command. Refs starting with `-` are rejected.
- The pre-0.7 `.leash/turn-base` marker is no longer read (a committed one ran as a shell command) or deleted. The git-dir marker is used only if it holds a tree id.
- Likely secret files (`.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, SSH keys, `.npmrc`, `.netrc`) are never sent to the API.

### Fixed

- An added line starting with `++ ` was read as the file's path, so a file could rename itself out of judgment. `+++` now counts only in the file header.
- Files with non-ASCII names were never judged (git octal-quoted their paths). Git runs with `core.quotepath=off`, and quoted paths are decoded.
- A scratch-index lock left by a killed snapshot disabled every later snapshot and check. The scratch index now lives in a fresh temp dir per call, which also stops two sessions in one checkout racing on it.

## [0.14.0] - 2026-10-09

### Added

- **Host-aware `init`.** When cmaintz-skills' `hooks/leash.sh` (the Foundry adapter) is registered in the global or project Claude Code settings, `leash init` installs no turn hooks and removes any it installed before, so a repo is never double-hooked. `--edit-phase` still adds the per-edit hook; `--standalone` forces Leash's own hooks. New exports: `hasFoundryAdapter`, `addEditHook`.
- **Gate boundary test.** `test/boundary.test.ts` fails if a workflow, mise task or npm script in this repo runs a Jev-backed command. `guard`, `compile` and `report` stay allowed.

### Fixed

- `.leash/sources.json` restamped after the 0.13 README changes, which had left a false stale-rubric nudge.

## [0.13.0] - 2026-10-09

### Added

- **`leash bench [--sample N]`**: replays the last N commits as turns through the Stop hook's check. Reports request and turn latency (p50/p95/max), characters sent, and the token usage the API reports. It shows no price; multiply the tokens by your own rate. New exports: `timedProvider`, `benchReport`, `percentiles`.

## [0.12.0] - 2026-10-09

### Added

- **Stale-rubric nudge.** `leash compile` now records a hash of each instruction file in `.leash/sources.json`: `CLAUDE.md`, `AGENTS.md`, and every Markdown file a rule cites as its `source`. Hashes ignore line endings. A new `SessionStart` hook, `leash session`, compares them with the files and, when one changed, gives the agent `additionalContext` telling it to update the rubric and recompile. `leash init` installs it for Claude Code and Codex. New exports: `instructionFiles`, `stampSources`, `staleSources`, `staleNudge`, `sessionStartOutput`, `hashText`, `SOURCES_PATH`.
- Leash records its own sources (`.leash/sources.json`).

## [0.11.0] - 2026-10-09

### Added

- **Turn deadline.** A turn's check now has a 60s budget (`LEASH_DEADLINE_MS`). Past it, files not yet judged are skipped as `turn deadline reached` and calls still in flight are cancelled, so the hook returns on time. `JevRequest` takes an optional `signal` (never sent on the wire); `checkTurn` takes `options.signal`.
- **Host timeouts.** `leash init` sets `timeout` on every hook: Stop and per-edit 90s, snapshot 30s. It is the same key, in seconds, for Claude Code and Codex. Re-running `init` now upgrades an older install in place instead of skipping it.
- **Miss log.** Each run where a hook let work through unchecked (no key, a failed call, the deadline, a crash) appends a JSON line to `leash-misses.log` in the git dir. The log is capped at 200 lines. `leash report` prints the last five.

## [0.10.0] - 2026-10-09

### Added

- **`leash login`**: stores your API key in `~/.leash/.env`, owner-only. Prompts with hidden input on a terminal, or reads a piped key.
- **Key files.** Settings now resolve from the process env, then the repo's `.env.local`, then `.env`, then `~/.leash/.env`. Only Leash's own keys (`JEV_*`, `TYPESAFE_AI_*`, `LEASH_*`) are read from those files. New exports: `resolveEnv`, `envFiles`, `parseEnvFile`, `saveApiKey`, `userEnvPath`.

### Changed

- The no-key skip message now points at `leash login`.

## [0.9.1] - 2026-10-04

### Fixed

- **Stop hook: repairs are verified again, and nothing can loop.** Since 0.5 the Stop hook returned early whenever `stop_hook_active` was set, on the belief that only Codex sends it. Claude Code sends it too (true once any Stop hook has forced a continuation), so after a single block the agent's repair was never re-checked, and a continuation forced by a *different* Stop hook skipped Leash entirely. Now every Stop is checked, but each finding blocks at most once per turn: a per-turn block record (fingerprints, in the git dir, reset by the next snapshot) is subtracted before deciding. A finding Jev keeps reporting cannot loop; a new break introduced while repairing is still caught. New export `stopDecisionOnce`, plus `readBlocked` / `recordBlocked`.
- README: documents that building a snapshot hashes untracked, non-ignored files into `.git/objects` (as `git add` would; nothing is committed and `git gc` prunes them).

### Changed

- Leash dogfoods itself: a committed `.leash/rubric.json` (fail-open, single-purpose functions, no premature abstraction, no silent error swallowing; line length deferred to eslint) guarded on every PR by a new `leash-guard` workflow.
- README: the "Works with Foundry" section no longer claims a boundary guard that does not exist (Foundry's boundary test covers `scripts/jev`, not Leash); it now states what is true. New "Use in CI" section for `leash guard`.

## [0.9.0] - 2026-10-04

### Fixed

- **The per-edit check never actually worked.** The documented 0.4 recipe ran `leash edit-check "$CLAUDE_FILE_PATH"`, but Claude Code sets no such variable - the edited path arrives on stdin as `tool_input.file_path` - so the check always got an empty argument. And even with a path, its plain exit-0 output only reached Claude Code's debug log, never Claude.

### Added

- **`leash edit-hook`**: a real PostToolUse handler. It reads `tool_input.file_path` from the hook payload (absolute; mapped to a repo-relative path, silent for files outside the repo), checks that file's diff against edit-phase rules, subtracts the ratchet baseline, and returns repair-band breaks as `hookSpecificOutput.additionalContext` - advisory text Claude sees, never a block.
- **`leash init --edit-phase`** wires it (PostToolUse, matcher `Edit|Write|MultiEdit`); `uninstall` removes it with the rest. Still off by default.
- New exports: `editHookOutput`, `repoRelative`, `EditHookOutput`, `InstallOptions` (`addLeashHooks(settings, { editPhase })`).

### Changed

- `leash edit-check <file>` now subtracts the ratchet baseline and skips ignored files and `.leash/`, the same as the turn check.

## [0.8.0] - 2026-10-04

### Added

- **OpenCode adapter.** `leash init --opencode` / `uninstall --opencode` write or remove a generated plugin (`.opencode/plugins/leash.js`, or `~/.config/opencode/plugins/leash.js` globally). OpenCode hooks return `void` - there is no "block the stop" - so the plugin snapshots on each user message (`chat.message`), checks once when the session goes idle (`session.status` idle, or the deprecated `session.idle`), and on a repair-band break sends the reason back as one follow-up prompt via `client.session.prompt`. Loop guard: at most one check and one nudge per user turn, and Leash's own nudge never resets the turn. Verified against the anomalyco/opencode plugin and event schemas; Bun shell semantics (array args, `.cwd().quiet().nothrow()`) checked with a real Bun.
- **`leash check --json`**: one stable, versioned JSON object (`version`, `base`, `ran`, `reason`, `findings` = new findings only, `skipped`, `decision`) for the OpenCode plugin and CI. It is valid JSON even with no key or rubric (`ran: false`).
- **`leash check --turn`**: diff against the turn snapshot (what the hooks judge) instead of a base ref.

### Changed

- CLI arguments: flags may now sit anywhere; the first non-flag argument is the base ref / file / sample size.
- Shared `writeFileEnsuringDir` / `removeIfExists` helpers behind the command and plugin installers.

## [0.7.0] - 2026-10-04

Turn-check correctness. Every fix here is something 0.6 silently got wrong.

### Fixed

- **Files created during a turn are now judged.** The turn snapshot was `git stash create` plus `git diff`, which ignore untracked files - so a brand-new file (the most common thing an agent writes) was never checked. Snapshots are now a git tree of the whole working tree (tracked + untracked, `.gitignore` respected), built in a scratch index so the real index is never touched. `leash check`, `audit` and `edit-check` use the same working-tree diff.
- **Large patches are actually chunked.** The README already promised this; nothing did it. An oversized patch is split on hunk boundaries (header repeated per chunk) and a rule counts as broken if any chunk breaks it.
- **One failed call no longer fails the whole turn.** Each file is isolated: a failing or timed-out call skips only that file, reported as `[skipped]` by `check` / `audit`.
- **Requests time out** (20 s default, `LEASH_TIMEOUT_MS`), so a hung connection cannot stall an agent's turn.
- The turn marker moved from `.leash/turn-base` (which showed up in `git status`) into the git dir; the old marker is still read once and then removed.

### Changed

- Files are judged with bounded concurrency (4 at a time) instead of one after another; findings keep diff order.
- Lockfiles, minified bundles, source maps (`DEFAULT_IGNORE`), binary patches and `.leash/` are never sent to Jev.
- New exports: `mapLimit`, `Skipped`, `CheckOptions`, `chunkPatch`, `mergeAnswers`, `isBinaryPatch`, `isLeashPath`, `MAX_PATCH_CHARS`, `DEFAULT_IGNORE`, `isIgnored`, `DEFAULT_TIMEOUT_MS`, `worktreeTree`, `writeTurnBase`, `readTurnBase`, `diffToWorktree`.
- The diff parser now has tests (it had none).

## [0.6.0] - 2026-10-04

First versioned release. Everything below shipped as internal milestones v0.1 to v0.6 while the package sat at 0.1.0; this release stamps them.

### Added

- **v0.1:** the offline core of a Jev-powered, turn-level output-quality guardrail for coding agents.
- `parseRubric` - validate a committed, readable rubric where each rule is one narrow yes/no question with a `repairAt` / `noteAt` band, optional `scope`, and `source` provenance.
- Pure engine: `questionsForFile` (batches one Noul per in-scope rule), `findingsForFile` (bands the answers), and the **ratchet** (`fingerprint`, `newFindings`, `baselineFrom`) so only newly introduced violations are flagged and the baseline can only shrink.
- `checkTurn` - one batched Jev call per changed file, banded and ratcheted; driven by the shared `JevProvider` port (`providerFromEnv` fails open with no key, honors `TYPESAFE_AI_BASE_URL`).
- `leash` CLI: `report`, `audit`, `check`. Always exits 0 (advisory, never breaks a session).
- Foundry TS gate: prettier, eslint (max-len), knip, tsc strict, vitest.
- **v0.2:** Claude Code turn hook. `stopDecision` blocks a turn only on a repair-band break (the agent fixes it in the same turn), `leash snapshot` records the pre-turn tree (`git stash create`) so the check sees only this turn, `leash hook` is the Stop handler, and `leash init` / `uninstall` wire both hooks into a Claude Code `settings.json` idempotently.
- **v0.3:** `leash compile` validates the rubric and reports the deterministic-first split; a new optional per-rule `handledBy` defers a rule to a named deterministic tool (the engine skips it, so Jev is spent only where nothing else can decide). `leash guard <baseRef>` is a hard check that fails when the rubric is loosened (a rule removed, a band threshold raised, or a rule newly deferred). The agent authors the rubric from `CLAUDE.md` with no second model; see [docs/COMPILE.md](docs/COMPILE.md).
- **v0.4:** `leash calibrate [--sample N]` scores each active turn-phase rule over the last N commits (default 20) and flags rules that never fire as dead-rule candidates, so the rubric stays honest (`calibrationReport` / `tallyFires` exported). Opt-in edit-phase: `leash edit-check <file>` judges one file's working-tree diff against `phase: "edit"` rules; deliberately **not** wired by `leash init` (per-edit auto-repair is sharp at Jev's edit-level precision), with a documented opt-in `PostToolUse` recipe.
- **v0.5:** Codex turn hook. `leash init --codex` / `uninstall --codex` wire the same `snapshot` + `hook` pair into `.codex/hooks.json` (global or `--project`); Codex shares Claude Code's exact Stop contract, so the pure hook logic is unchanged. The runner now honors Codex's `stop_hook_active` flag (no re-block loop). The install core is generalized behind a `Host` type (`hostConfigPath` exported); `addLeashHooks` / `removeLeashHooks` are host-agnostic.
- **v0.6:** `/leash-rubric` authoring command. On Claude Code, `leash init` also drops a `/leash-rubric` slash command into `.claude/commands/` (and `uninstall` removes it) that walks the agent through the `docs/COMPILE.md` procedure - read the instruction files, keep only the un-lintable rules, write `.leash/rubric.json`, then `leash compile`. Still no second model. The command text and the `writeRubricCommand` / `removeRubricCommand` / `rubricCommandPath` helpers are exported.

### Changed

- Package renamed to `@cmaintz/leash`: the unscoped `leash` name is taken on npm. The `leash` binary is unchanged.
- `leash version` now reads the version from `package.json` instead of a hardcoded string, so it cannot drift.

[Unreleased]: https://github.com/CMaintz/leash/compare/v0.9.1...HEAD
[0.9.1]: https://github.com/CMaintz/leash/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/CMaintz/leash/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/CMaintz/leash/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/CMaintz/leash/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/CMaintz/leash/releases/tag/v0.6.0
