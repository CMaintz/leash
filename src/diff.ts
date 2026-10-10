// Minimal unified-diff parser: split `git diff` output into one patch per file.

export interface FileDiff {
  file: string;
  patch: string;
}

interface Current {
  file: string;
  lines: string[];
  /** Still in the file header (before the first hunk); only here is `+++ ` a path. */
  header: boolean;
}

/** Parse `git diff` text into per-file patches (skips deletions to /dev/null). */
export function parseDiff(text: string): FileDiff[] {
  const out: FileDiff[] = [];
  let current: Current | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush(out, current);
      current = { file: fileFromHeader(line), lines: [line], header: true };
    } else if (current) {
      readLine(current, line);
    }
  }
  flush(out, current);
  return out.filter((d) => d.file !== '/dev/null');
}

// An added content line can start with `++ ` too (shown as `+++ ...`), so a `+++` path
// counts only in the header; otherwise a file could rename itself out of judgment.
function readLine(current: Current, line: string): void {
  if (line.startsWith('@@')) current.header = false;
  if (current.header && line.startsWith('+++ ')) current.file = plusPath(line) ?? current.file;
  current.lines.push(line);
}

function flush(out: FileDiff[], current: Current | null): void {
  if (current) out.push({ file: current.file, patch: current.lines.join('\n') });
}

function fileFromHeader(line: string): string {
  const quoted = /^diff --git (?:"a\/(?:[^"\\]|\\.)*"|a\/.+?) ("b\/(?:[^"\\]|\\.)*")$/.exec(line);
  if (quoted) return unquotePath(quoted[1]!).slice(2);
  const match = /^diff --git a\/.+ b\/(.+)$/.exec(line);
  return match?.[1] ?? 'unknown';
}

function plusPath(line: string): string | null {
  const path = unquotePath(line.slice(4).trim());
  if (path === '/dev/null') return '/dev/null';
  return path.startsWith('b/') ? path.slice(2) : path;
}

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/** Decode git's C-style quoted path ("a\303\251" -> "aé"); unquoted paths pass through. */
export function unquotePath(path: string): string {
  if (!(path.startsWith('"') && path.endsWith('"') && path.length >= 2)) return path;
  const parts = [...path.slice(1, -1).matchAll(/\\([0-7]{3}|.)|[^\\]+/gs)].map(toBytes);
  return Buffer.concat(parts).toString('utf8');
}

function toBytes([whole, escape]: RegExpMatchArray): Buffer {
  if (escape === undefined) return Buffer.from(whole, 'utf8');
  if (/^[0-7]{3}$/.test(escape)) return Buffer.from([parseInt(escape, 8)]);
  return Buffer.from([ESCAPES[escape] ?? escape.charCodeAt(0)]);
}
