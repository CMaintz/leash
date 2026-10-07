// The Jev provider port. Same wire as foundry/scripts/jev/client.mjs and jev-triage,
// verified against https://docs.typesafe.ai/api. Zero deps; global fetch (Node 18+).

export type Question =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> };

export type Answer =
  | { type: 'noul'; noul: number }
  | {
      type: 'score';
      score: number;
      confidence: number;
      probabilities: Record<string, number>;
      legend?: Record<string, string>;
    }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };

export interface JevRequest {
  state: unknown;
  questions: Record<string, Question>;
}

export interface JevResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface JevProvider {
  evaluate(req: JevRequest): Promise<JevResponse>;
}

const RETRYABLE = new Set([429, 529]);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Per-request timeout default: a hung connection must never stall an agent's turn. */
export const DEFAULT_TIMEOUT_MS = 20_000;

/** POST JSON with the docs' recommended exponential backoff on 429/529, and a timeout. */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  maxAttempts = 4,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return res.json();
    if (RETRYABLE.has(res.status) && attempt < maxAttempts) {
      await sleep(250 * 2 ** (attempt - 1));
      continue;
    }
    throw new Error(`Jev request failed: ${res.status} ${await res.text()}`);
  }
}

/** TypeSafe first-party adapter. */
export class TypeSafeProvider implements JevProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = 'jev-latest',
    private readonly baseUrl = 'https://api.typesafe.ai/v1',
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async evaluate(req: JevRequest): Promise<JevResponse> {
    const json = await postJson(
      `${this.baseUrl}/systemone`,
      { Authorization: `Bearer ${this.apiKey}` },
      { model: this.model, state: req.state, questions: req.questions },
      4,
      this.timeoutMs,
    );
    return json as JevResponse;
  }
}

/** Build a provider from the environment, or null when no key is set (fail open).
 * LEASH_TIMEOUT_MS overrides the per-request timeout. */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): JevProvider | null {
  if (!env.JEV_API_KEY) return null;
  const baseUrl = env.TYPESAFE_AI_BASE_URL || 'https://api.typesafe.ai/v1';
  return new TypeSafeProvider(env.JEV_API_KEY, env.JEV_MODEL || 'jev-latest', baseUrl, timeoutFrom(env));
}

function timeoutFrom(env: NodeJS.ProcessEnv): number {
  const ms = Number(env.LEASH_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_TIMEOUT_MS;
}
