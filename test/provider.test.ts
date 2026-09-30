import { afterEach, describe, expect, it, vi } from 'vitest';
import { postJson, providerFromEnv, TypeSafeProvider } from '../src/provider.js';

describe('postJson', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts JSON and parses the response', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await postJson('https://x', { Authorization: 'Bearer k' }, { a: 1 });
    expect(out).toEqual({ ok: true });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ a: 1 });
  });

  it('retries a 429 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await postJson('https://x', {}, {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('providerFromEnv', () => {
  it('returns null without a key (fail open)', () => {
    expect(providerFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('builds a TypeSafe provider and honors the base-url override', () => {
    const provider = providerFromEnv({
      JEV_API_KEY: 'k',
      TYPESAFE_AI_BASE_URL: 'http://x/v1',
    } as NodeJS.ProcessEnv);
    expect(provider).toBeInstanceOf(TypeSafeProvider);
  });
});
