// The bundled `/leash-rubric` slash command. It drives the exact COMPILE.md procedure:
// the coding agent authors `.leash/rubric.json` from the project's instruction files and
// then runs `leash compile` to validate it. No second model is involved - this is just the
// instruction text, shipped so `leash init` can drop it into a Claude Code commands dir.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { removeIfExists, writeFileEnsuringDir } from './files.js';

/** The command file's contents (front matter + the authoring procedure). */
export const RUBRIC_COMMAND = `---
description: Author .leash/rubric.json from this project's instruction files, then validate it.
---

Author or update \`.leash/rubric.json\` for Leash, then validate it. Leash uses no second
model for this step: you write the rubric and \`leash compile\` checks it.

1. Read the project's instruction files: \`CLAUDE.md\`, \`AGENTS.md\`, and any coding-standard
   docs they link.
2. Extract only the un-lintable rules, the ones no formatter, linter, type checker, or test
   can decide (for example "no premature abstractions", "never let a raw error reach a user",
   "functions do one thing"). Skip anything a tool already enforces (line length, import
   order, formatting, unused vars, types). If a rule is a near-miss of a tool's job, keep it
   but set \`handledBy\` to that tool so Leash defers it.
3. Phrase each \`question\` as a narrow yes/no where a break reads as \`true\` (Leash asks it as
   a Noul): "Does this change add an abstraction used in only one place?" is good; "Is the
   code clean?" is not. Give each rule a \`scope\` glob, a \`source\` line reference, and
   \`repairAt\`/\`noteAt\` bands (defaults 0.8 / 0.5).
4. Write \`.leash/rubric.json\`, then run \`leash compile\` and fix whatever it reports. Do not
   invent rules the instruction files do not state.
`;

const COMMAND_DIR = join('.claude', 'commands');
const COMMAND_FILE = 'leash-rubric.md';

/** Where the slash command lives: project (in-repo) or personal (home). */
export function rubricCommandPath(project: boolean): string {
  return project ? join(COMMAND_DIR, COMMAND_FILE) : join(homedir(), COMMAND_DIR, COMMAND_FILE);
}

/** Write the `/leash-rubric` command, creating the commands dir if needed. */
export function writeRubricCommand(project: boolean): string {
  return writeFileEnsuringDir(rubricCommandPath(project), RUBRIC_COMMAND);
}

/** Remove the command file if present. Returns the path whether or not it existed. */
export function removeRubricCommand(project: boolean): string {
  return removeIfExists(rubricCommandPath(project));
}
