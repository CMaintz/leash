import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { applyKeystrokes, readSecret } from '../src/secret.js';

describe('applyKeystrokes', () => {
  it('accumulates, honors backspace, and finishes on Enter', () => {
    const typing = applyKeystrokes('', 'abx\u007fc');
    expect(typing).toEqual({ value: 'abc', done: false, cancelled: false });
    expect(applyKeystrokes(typing.value, 'd\r')).toEqual({ value: 'abcd', done: true, cancelled: false });
  });

  it('cancels on Ctrl-C without keeping what was typed', () => {
    expect(applyKeystrokes('secret', '\u0003')).toEqual({ value: '', done: true, cancelled: true });
  });
});

describe('readSecret', () => {
  it('reads the whole pipe when stdin is not a terminal', async () => {
    const piped = Readable.from([' sk-123\n']) as unknown as NodeJS.ReadStream;
    expect(await readSecret('unused', piped)).toBe('sk-123');
  });
});
