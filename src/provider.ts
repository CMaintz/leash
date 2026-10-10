// The Jev provider port: a thin layer over @cmaintz/jev-core that keeps Leash's API.
// Leash adds a shorter default timeout (a hung call must never stall an agent's turn),
// LEASH_TIMEOUT_MS, and a `signal` on the request (the turn deadline).
import {
  postJson as corePostJson,
  TypeSafeProvider as CoreTypeSafeProvider,
  type JevRequest as CoreJevRequest,
  type JevResponse,
} from '@cmaintz/jev-core';

export type { Answer, JevResponse, Question } from '@cmaintz/jev-core';

export interface JevRequest extends CoreJevRequest {
  /** Aborts the call (the turn deadline); never sent on the wire. */
  signal?: AbortSignal;
}

export interface JevProvider {
  evaluate(req: JevRequest): Promise<JevResponse>;
}

/** Per-request timeout default: a hung connection must never stall an agent's turn. */
export const DEFAULT_TIMEOUT_MS = 20_000;

/** POST JSON with the docs' recommended exponential backoff on 429/529, a per-request
 * timeout, and an optional outer `signal` (the turn deadline) that also ends the retries. */
export function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  maxAttempts = 4,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<unknown> {
  return corePostJson(url, headers, body, { maxAttempts, timeoutMs, ...(signal ? { signal } : {}) });
}

/** TypeSafe first-party adapter. Responses are validated against the questions asked. */
export class TypeSafeProvider implements JevProvider {
  private readonly core: CoreTypeSafeProvider;

  constructor(
    apiKey: string,
    model = 'jev-latest',
    baseUrl = 'https://api.typesafe.ai/v1',
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.core = new CoreTypeSafeProvider(apiKey, model, baseUrl, timeoutMs);
  }

  evaluate({ signal, ...req }: JevRequest): Promise<JevResponse> {
    return this.core.evaluate(req, signal ? { signal } : {});
  }
}

/** Build a provider from the environment, or null when no key is set (fail open).
 * TypeSafe only: JEV_PROVIDER and CLOUDFLARE_ACCOUNT_ID are ignored. LEASH_TIMEOUT_MS
 * overrides the per-request timeout. */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): JevProvider | null {
  if (!env.JEV_API_KEY) return null;
  const baseUrl = env.TYPESAFE_AI_BASE_URL || 'https://api.typesafe.ai/v1';
  return new TypeSafeProvider(env.JEV_API_KEY, env.JEV_MODEL || 'jev-latest', baseUrl, timeoutFrom(env));
}

function timeoutFrom(env: NodeJS.ProcessEnv): number {
  return positiveMs(env.LEASH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

/** A positive millisecond setting, or `fallback` when unset or malformed. */
export function positiveMs(raw: string | undefined, fallback: number): number {
  const ms = Number(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : fallback;
}
