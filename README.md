# Leash

Keep a coding agent's output quality on a short leash. Leash judges every turn
against your project's un-lintable rules using [Jev](https://typesafe.ai) (TypeSafe's
System One decision model), and tells the agent exactly which rule it broke so it
fixes it before moving on. About 300 ms and a fraction of a cent per turn.

> Jev-powered. Inspired by [Abide](https://www.npmjs.com/package/@coldtea/abide); the
> difference is the ratchet (below) and deterministic-first rule compilation.

## Why

Your `CLAUDE.md` / `AGENTS.md` is full of rules no linter can check: "no premature
abstractions", "never let a raw error reach a user", "small single-purpose functions".
Nothing enforces them, so the agent breaks them from the first edit. A frontier LLM
could judge each rule, but at a cent and a few seconds per check it never pays off.
Jev answers one typed question per rule with a calibrated probability in ~300 ms for a
fraction of a cent, which is what makes checking every turn viable.

## What makes it different: the ratchet

Judging every file as if freshly written buries you in findings on a real repo. Leash
borrows Foundry's accepted-debt baseline: existing violations are baselined once, and
Leash only ever flags what a turn **newly** introduces. The baseline is one-way, it can
only shrink. That is what makes it adoptable on an existing codebase from day one.

Turn-check is the default (once per turn, on the whole diff, where the un-lintable
questions actually have an answer). A per-edit mode exists but is off by default: at
Jev's edit-level precision, per-edit auto-repair risks the agent chasing phantoms.

## Install

```
npm install -g @cmaintz/leash   # or: npx @cmaintz/leash <command>
```

Set a key once:

```
leash login               # prompts (input hidden); or pipe it: Get-Clipboard | leash login
```

That stores `JEV_API_KEY` in `~/.leash/.env`, readable only by you (mode 0600 on
macOS/Linux; on Windows the file sits in your user profile and inherits its ACL). Leash
looks for its settings in this order: the process env, then the repo's `.env.local`,
then its `.env`, then `~/.leash/.env`. From those files it reads only its own keys
(`JEV_*`, `TYPESAFE_AI_*`, `LEASH_*`), never your app's other secrets.
`TYPESAFE_AI_BASE_URL` points it at a self-host, proxy or mock. No key means Leash
no-ops and lets the edit through, always.

## Use

```
leash report              # list the rules in .leash/rubric.json
leash compile             # validate the rubric, show the active vs deferred split
leash audit               # accept the current diff's findings into the baseline
leash check [baseRef]     # print what this turn newly broke (default base: HEAD)
                          #   --turn: since the turn snapshot; --json: machine-readable
leash guard [baseRef]     # fail if the rubric was loosened vs baseRef (for CI)
leash calibrate [N]       # score rules against the last N commits (default 20); flag dead ones
leash edit-check <file>   # opt-in per-edit check of one file (see below)
```

`leash calibrate` runs each active turn-phase rule over the diffs of the last N commits
(`--sample N` or a bare `N`, default 20) and reports how often each actually fires. A rule
that never fires is flagged as a dead-rule candidate to reword or remove, so the rubric
stays honest. Advisory and fail-open: no key just prints a skip.

You do not hand-write the rubric from scratch: your coding agent compiles it from your
`CLAUDE.md` / `AGENTS.md` (no second model involved - see [docs/COMPILE.md](docs/COMPILE.md)),
then `leash compile` validates it. On Claude Code, `leash init` also installs a
`/leash-rubric` slash command that walks the agent through exactly that, so first-time
setup is one command in the editor. Rules a linter or the gate already enforce are marked
`handledBy` and skipped (deterministic-first), so Jev is spent only where nothing else
can decide. `leash guard` makes any later weakening of the rubric a red, reviewable check.

A rubric is a committed, readable `.leash/rubric.json`. Each rule is one narrow yes/no
question, phrased so a break reads as `true`, with a `repairAt` / `noteAt` band and an
optional `scope`, `source` (the instruction-file line it came from), and `handledBy`
(a deterministic tool that owns it instead):

```json
{
  "version": 1,
  "rules": [
    {
      "id": "no-premature-abstraction",
      "question": "Does this change add an abstraction (interface, wrapper, base class) used in only one place?",
      "phase": "turn",
      "scope": ["src/**/*.ts"],
      "repairAt": 0.8,
      "noteAt": 0.5,
      "source": "CLAUDE.md:42"
    }
  ]
}
```

## Time budget and the miss log

A hook must never stall the agent. Each Jev request times out after 20s
(`LEASH_TIMEOUT_MS`), and a whole turn's check gets 60s (`LEASH_DEADLINE_MS`). When
the time is up, unjudged files are skipped, any request still waiting is cancelled,
and the turn goes through. `leash init` also gives each hook a host timeout (90s for
the Stop and per-edit hooks, 30s for the snapshot) as a backstop.

Failing open is never silent. Each time a hook lets work through unchecked, it adds a
line to `leash-misses.log` in the git dir, never in your working tree. That covers no
key, a failed call, and the deadline. `leash report` shows the last few entries.

## Claude Code (turn hook)

Leash runs as three Claude Code hooks:

- a `SessionStart` hook warns the agent when the rubric is out of date (see below);
- a `UserPromptSubmit` hook snapshots the working tree at the start of a turn;
- a `Stop` hook checks what that turn changed. On a repair-band break it blocks the stop
  and hands the agent the exact rules to fix, so it repairs them in the same turn.

Install all three in one command:

```
leash init              # writes the hooks into ~/.claude/settings.json (idempotent)
leash init --project    # or into this repo's .claude/settings.json
leash uninstall         # removes them again
```

`init` also drops a `/leash-rubric` slash command into `.claude/commands/` (personal, or
in-repo with `--project`) that drives the authoring procedure in
[docs/COMPILE.md](docs/COMPILE.md); `uninstall` removes it. It merges into whatever is
already there and never duplicates; re-running it upgrades an older install. Under the
hood it adds the three hooks to `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "leash session", "timeout": 30 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "leash snapshot", "timeout": 30 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "leash hook", "timeout": 90 }] }]
  }
}
```

`leash compile` records a hash of each instruction file the rubric came from:
`CLAUDE.md`, `AGENTS.md`, and any Markdown file a rule cites as its `source`. The record
goes in `.leash/sources.json`, which you commit. At session start, `leash session` compares
those hashes with the files. If one changed, the agent is told to bring the rubric up to
date (via `/leash-rubric`) and run `leash compile` again. Line-ending differences don't
count as changes, and with no rubric it stays silent.

`leash snapshot` records the pre-turn state as a git tree of the whole working tree -
tracked **and untracked** files, minus anything `.gitignore`d - built in a scratch index
so your real index is never touched, and stored in the git dir rather than your working
tree. `leash hook` reads the Stop payload, diffs against that snapshot (so files the
agent created this turn are judged too), and prints `{"decision":"block","reason":...}`
only when a turn newly breaks a repair-band rule. No key or no rubric means it stays
silent and lets the agent stop (fail open).

Every Stop is checked, including the continuation after a block - that is when the
agent's repair gets verified, and when a repair that breaks something else gets caught.
But Leash blocks **at most once per finding per turn**: a rule it already flagged in this
turn never blocks again (so a finding Jev keeps wrongly reporting cannot loop), and only
genuinely new breaks can. The record lives in the git dir and resets on the next prompt.
(Claude Code's own cap of 8 consecutive continuations still applies on top.)

One side effect to know: building the snapshot hashes untracked, non-ignored files into
`.git/objects` (the same thing `git add` would do; nothing is committed, and `git gc`
prunes the objects later). Keep secrets in `.gitignore`d files, as you would anyway.

### Opt-in: per-edit checks (off by default)

For rules with `"phase": "edit"`, Leash can judge each file right after Claude writes it.
It is **not** wired by default: at Jev's edit-level precision, per-edit feedback risks the
agent chasing phantoms, which is why turn checks are the default. Opt in with:

```
leash init --edit-phase           # adds a PostToolUse hook for Edit|Write|MultiEdit
```

That adds:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "leash edit-hook", "timeout": 90 }]
      }
    ]
  }
}
```

`leash edit-hook` reads the edited path from the hook payload (`tool_input.file_path`),
checks only that file's diff against edit-phase rules, subtracts the ratchet baseline, and
on a repair-band break returns it as `additionalContext` - advisory text Claude sees and
weighs, never a block. It stays silent without a key, without edit-phase rules, or for files
outside the repo. To check one file by hand, use `leash edit-check <file>`.

## Codex (turn hook)

Codex's hook system is the same contract as Claude Code's - the same `hooks.json`
shape, the same `SessionStart`, `UserPromptSubmit` and `Stop` events, the same `timeout`
key in seconds, and the same `{"decision":"block","reason":...}` output (Codex injects
`reason` as the next user message). The same three hooks drive it. Install with `--codex`:

```
leash init --codex               # writes ~/.codex/hooks.json
leash init --codex --project     # or this repo's .codex/hooks.json
leash uninstall --codex
```

It writes the same `session`, `snapshot` and `hook` set. Codex loads hooks straight from that
`hooks.json` (no separate enable flag), so `leash init --codex` is all it takes; a
project-local `.codex/` must be trusted first. The same once-per-finding rule as on
Claude Code applies, so continuations are re-checked but nothing can loop.
The contract is checked against Codex's own generated schemas (`stop.command.input` /
`stop.command.output`): the `Stop` input carries `cwd` + `stop_hook_active`, and a
`{"decision":"block","reason":...}` reply forces continuation, same as Claude Code. No
key or no rubric still means silent fail-open.

## OpenCode (plugin)

OpenCode's plugin hooks return `void`, so there is no Claude/Codex-style "block the stop".
Leash does the closest honest thing: a generated plugin that re-prompts once.

```
leash init --opencode             # writes ~/.config/opencode/plugins/leash.js
leash init --opencode --project   # or this repo's .opencode/plugins/leash.js
leash uninstall --opencode
```

The plugin runs `leash snapshot` on each user message, and when the session goes idle it
runs `leash check --turn --json` once. On a repair-band break it sends the reason back
into the session as a single follow-up prompt (`client.session.prompt`), so the agent
repairs it in a new turn rather than the same one. Loop guard: at most one check and
one nudge per user turn (the repair turn is not re-checked, unlike Claude Code / Codex), and Leash's own nudge
never resets the turn. It needs `leash` on `PATH` (a global install); if it is missing,
the plugin fails open and stays silent. The stale-rubric session nudge is not wired for
OpenCode; run `leash session` by hand after editing your instruction files.

## Machine-readable checks

`leash check --json` prints one stable JSON object - the contract the OpenCode plugin and
CI consume. `--turn` diffs against the turn snapshot instead of a base ref:

```json
{
  "version": 1,
  "base": "HEAD",
  "ran": true,
  "findings": [
    {
      "ruleId": "no-premature-abstraction",
      "file": "src/new.ts",
      "probability": 0.93,
      "band": "repair",
      "message": "..."
    }
  ],
  "skipped": [],
  "decision": { "decision": "block", "reason": "Leash: this turn broke 1 project rule(s): ..." }
}
```

`findings` are only the new (non-baselined) ones. With no key or no rubric it still prints
valid JSON: `"ran": false`, a `reason`, empty `findings`, and an empty `decision`.

## Library

Leash is library-first; the CLI and the agent hooks are thin wrappers over the same
exports, so a host can drive the core directly:

```ts
import { checkTurn, parseDiff, parseRubric, providerFromEnv } from '@cmaintz/leash';

const provider = providerFromEnv();
if (provider) {
  const { actionable } = await checkTurn(provider, rubric, parseDiff(diffText), baseline);
}
```

## Works with Foundry

Leash is designed to plug into [Foundry](https://github.com/CMaintz/foundry) with no
friction: a deterministic-first compile skips any rule the six-verb gate or habit-hooks
already enforce (`handledBy`), and the baseline uses Foundry's one-way ratchet
convention. Leash never runs inside `mise run gate`: it runs as agent hooks and on
demand, and every Jev-backed command exits 0. Only `compile` (malformed rubric) and
`guard` (loosened rubric) can fail, and both are deterministic, so they are safe in CI.
It is a coach on the proposer side, never an oracle.

## Use in CI

`leash guard` needs no key and no Jev call: it compares the rubric against the base
branch and fails if a rule was removed, a threshold raised, or a rule newly deferred.
That makes "weaken the rules to get a green turn" a visible, reviewable change:

```yaml
- uses: actions/checkout@v5
  with: { fetch-depth: 0 }
- run: npx @cmaintz/leash guard "origin/$BASE_REF"
  env:
    BASE_REF: ${{ github.base_ref }}
```

Leash dogfoods this: its own [`.leash/rubric.json`](.leash/rubric.json) (fail-open,
single-purpose functions, no premature abstraction, no silent swallow, plus line length
deferred to eslint) is guarded by the `leash-guard` workflow on every PR.

## Honest limits

Jev is about 68% accurate, so Leash is advisory: it never blocks a commit or fails a
build. It says which rule and how likely, never why or how many; the agent supplies the
fix. Text-only, so it judges per file (up to 4 files in parallel) and splits a patch too
large for one call into hunk-sized chunks, flagging a rule if any chunk breaks it.
Lockfiles, minified bundles, source maps, binary files and `.leash/` itself are never
sent. A call that fails or times out (20 s, `LEASH_TIMEOUT_MS` to change) skips only
that file: `leash check` lists it as `[skipped]`, and the Stop hook lets the turn through.

## Contributing

Plain npm, no special tooling:

```
npm install
npm run lint        # eslint + prettier
npm run typecheck   # tsc --strict
npm test            # vitest
npm run build
```

The maintainer additionally runs a [Foundry](https://github.com/CMaintz/foundry)
quality gate (mise verbs + habit-hooks structural smells); the committed `mise.toml`
and `.habit-hooks/` support that. Neither is required to build, test, or contribute -
they are an optional overlay, and habit-hooks never needs to be installed to use Leash.

## Releasing

Versioned per [Semantic Versioning](https://semver.org/) with a [CHANGELOG](CHANGELOG.md).
Bump `package.json` and add the CHANGELOG section in a PR; after it merges, push the tag:

```
git tag v0.8.0 && git push origin v0.8.0
```

The `release` workflow then checks the tag matches `package.json`, re-runs the gate,
publishes `@cmaintz/leash` to npm with provenance, and cuts the GitHub release from that
version's CHANGELOG section. It needs an `NPM_TOKEN` repository secret.

## License

MIT.
