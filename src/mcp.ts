import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { CheckResult } from './check.js';
import { cliProvider, deadlineBudgetMs } from './cli-store.js';
import { RUBRIC_COMMAND } from './commands.js';
import {
  drift,
  explainRule,
  jevJudge,
  judgeAgainstCommittedRubric,
  listRules,
  rubricText,
  wholeFilesDiff,
  worktreeDiff,
  type ProviderSource,
} from './mcp-tools.js';

export interface McpServerOptions {
  provider?: ProviderSource;
  version?: string;
}

const LIMITS =
  'Results are advice to weigh, not a verdict: Jev is about 68% accurate, and replay measured about 73% ' +
  'precision at turn level and 26% at edit level, so the edit phase is noisy. Never fails: a missing key, ' +
  'rubric or a failed call comes back in `skipped` with a reason.';

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
const CALLS_JEV = { readOnlyHint: true, openWorldHint: true };

const finding = z.object({
  ruleId: z.string(),
  file: z.string(),
  probability: z.number(),
  band: z.enum(['repair', 'note', 'off']),
  message: z.string(),
  source: z.string().optional(),
});
const checkOutput = {
  actionable: z.array(finding).describe('findings not in the ratchet baseline: the ones worth acting on'),
  findings: z.array(finding).describe('every finding, baselined debt included'),
  skipped: z.array(z.object({ file: z.string(), reason: z.string() })).describe('file "*" means the whole request'),
};
const rule = z.object({
  id: z.string(),
  question: z.string(),
  phase: z.enum(['turn', 'edit']),
  scope: z.array(z.string()),
  repairAt: z.number(),
  noteAt: z.number(),
  source: z.string().optional(),
  handledBy: z.string().optional(),
});
const explainOutput = {
  rule: rule.nullable(),
  calibration: z.object({ rule: z.string(), fires: z.number(), rate: z.number(), dead: z.boolean() }).nullable(),
  misses: z.array(z.object({ at: z.string(), command: z.string(), reason: z.string() })),
  reason: z.string().optional(),
};
const judgeInput = {
  question: z.string(),
  state: z.unknown().describe('the text or JSON the question is about'),
  kind: z.enum(['noul', 'score', 'choice']),
  options: z.array(z.string()).optional().describe('choice labels'),
  levels: z.array(z.string()).optional().describe('score levels, low to high (2 to 10)'),
};
const judgeOutput = {
  answer: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  probability: z.number().nullable(),
  skipped: z.string().optional(),
};

export function createMcpServer(options: McpServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'leash', version: options.version ?? '0.0.0' });
  const provider = options.provider ?? cliProvider;
  registerCheck(server, provider);
  registerJudgeFiles(server, provider);
  registerRuleTools(server, provider);
  registerJevJudge(server, provider);
  registerResources(server);
  registerRubricPrompt(server);
  return server;
}

// turnSignal counts from process start, which in a long-lived server would expire every
// request after the first budget's worth of uptime; each request gets the full budget.
function deadlineFromThisRequestsStart(cancel: AbortSignal): AbortSignal {
  return AbortSignal.any([cancel, AbortSignal.timeout(deadlineBudgetMs())]);
}

function registerCheck(server: McpServer, provider: ProviderSource): void {
  const description =
    "Check a change against this project's un-lintable rules (.leash/rubric.json) before you finish. " +
    'Pass `diff` (unified diff) to judge a plan or patch, or omit it to judge the working tree vs HEAD ' +
    '(optionally limited to `paths`). ' +
    LIMITS;
  const inputSchema = {
    diff: z.string().optional().describe('a unified diff; omit to judge the working tree vs HEAD'),
    paths: z
      .array(z.string())
      .optional()
      .describe('git pathspecs limiting the working-tree diff; ignored when `diff` is given'),
    phase: z.enum(['turn', 'edit']).optional().describe('which rules to ask (default turn; edit is noisy)'),
  };
  const config = { description, inputSchema, outputSchema: checkOutput, annotations: CALLS_JEV };
  server.registerTool('check', config, async ({ diff, paths, phase }, extra) => {
    const read = diff === undefined ? worktreeDiff(paths) : () => diff;
    return checkReply(
      await judgeAgainstCommittedRubric(provider, read, phase ?? 'turn', deadlineFromThisRequestsStart(extra.signal)),
    );
  });
}

function registerJudgeFiles(server: McpServer, provider: ProviderSource): void {
  const description =
    'Judge whole files as if just written (existing debt included), for files no diff touches. ' +
    'Never changes the baseline: accepting debt stays a deliberate `leash audit`. ' +
    LIMITS;
  const inputSchema = { paths: z.array(z.string()).min(1).describe('globs, matched like rubric scopes') };
  const config = { description, inputSchema, outputSchema: checkOutput, annotations: CALLS_JEV };
  server.registerTool('judge_files', config, async ({ paths }, extra) =>
    checkReply(
      await judgeAgainstCommittedRubric(
        provider,
        wholeFilesDiff(paths),
        'turn',
        deadlineFromThisRequestsStart(extra.signal),
      ),
    ),
  );
}

function checkReply(result: CheckResult): CallToolResult {
  const lines = result.actionable.map((f) => `[${f.band}] ${f.message}`);
  const baselined = result.findings.length - result.actionable.length;
  if (baselined) lines.push(`${baselined} baselined finding(s) hidden (see findings).`);
  for (const s of result.skipped) lines.push(`[skipped] ${s.file}: ${s.reason}`);
  const text = lines.length ? lines.join('\n') : 'leash: no new rule breaks.';
  return { content: [{ type: 'text', text }], structuredContent: { ...result } };
}

function reply(value: object): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: { ...value } };
}

function registerRuleTools(server: McpServer, provider: ProviderSource): void {
  const listConfig = {
    description:
      "List this project's Leash rules, or only those whose scope covers `path`. Reads the rubric as it is on " +
      'disk; `check` judges against the committed one, so an uncommitted edit shows here first.',
    inputSchema: { path: z.string().optional().describe('a repo-relative file path') },
    outputSchema: { rules: z.array(rule), reason: z.string().optional() },
    annotations: READ_ONLY,
  };
  server.registerTool('list_rules', listConfig, ({ path }) => reply(listRules(path)));
  registerExplainRule(server, provider);
}

function registerExplainRule(server: McpServer, provider: ProviderSource): void {
  const config = {
    description:
      'Explain one rule: its question, bands, source line and the last few unchecked runs. With `sample`, ' +
      'also measures how often it fires over that many recent commits (one Jev call per changed file).',
    inputSchema: {
      id: z.string(),
      sample: z.number().int().min(1).max(50).optional().describe('commits to calibrate over; omit to skip'),
    },
    outputSchema: explainOutput,
    annotations: CALLS_JEV,
  };
  server.registerTool('explain_rule', config, async ({ id, sample }, extra) =>
    reply(await explainRule(provider, id, sample, deadlineFromThisRequestsStart(extra.signal))),
  );
}

function registerJevJudge(server: McpServer, provider: ProviderSource): void {
  const config = {
    description:
      'Ask Jev one typed judgment about `state`: a yes/no (`noul`), a pick from `options` (`choice`) or a ' +
      'rank on `levels`, low to high (`score`). Sub-cent and about 300 ms; about 68% accurate, so weigh it. ' +
      'For noul, `probability` is that the statement is true; for choice, that of the picked option.',
    inputSchema: judgeInput,
    outputSchema: judgeOutput,
    annotations: CALLS_JEV,
  };
  server.registerTool('jev_judge', config, async (input, extra) =>
    reply(await jevJudge(provider, input, deadlineFromThisRequestsStart(extra.signal))),
  );
}

function registerResources(server: McpServer): void {
  const json = (uri: URL, text: string) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text }] });
  server.registerResource(
    'rubric',
    'leash://rubric',
    { description: 'The compiled .leash/rubric.json', mimeType: 'application/json' },
    (uri) => json(uri, rubricText()),
  );
  server.registerResource(
    'drift',
    'leash://drift',
    {
      description:
        'Whether the rubric was loosened vs HEAD, and whether CLAUDE.md/AGENTS.md changed since it was compiled',
      mimeType: 'application/json',
    },
    (uri) => json(uri, JSON.stringify(drift(), null, 2)),
  );
}

function registerRubricPrompt(server: McpServer): void {
  // Strip the slash command's frontmatter: it is host metadata, not prompt text.
  const text = RUBRIC_COMMAND.replace(/^---\n[\s\S]*?\n---\n+/, '');
  const config = { description: 'Author or update .leash/rubric.json from the instruction files' };
  server.registerPrompt('leash-rubric', config, () => ({
    messages: [{ role: 'user', content: { type: 'text', text } }],
  }));
}
