// Minimal unified-diff parser: split `git diff` output into one patch per file.

export interface FileDiff {
  file: string;
  patch: string;
}

/** Parse `git diff` text into per-file patches (skips deletions to /dev/null). */
export function parseDiff(text: string): FileDiff[] {
  const out: FileDiff[] = [];
  let current: { file: string; lines: string[] } | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git')) {
      flush(out, current);
      current = { file: fileFromHeader(line), lines: [line] };
    } else if (current) {
      if (line.startsWith('+++ ')) current.file = plusPath(line) ?? current.file;
      current.lines.push(line);
    }
  }
  flush(out, current);
  return out.filter((d) => d.file !== '/dev/null');
}

function flush(out: FileDiff[], current: { file: string; lines: string[] } | null): void {
  if (current) out.push({ file: current.file, patch: current.lines.join('\n') });
}

function fileFromHeader(line: string): string {
  const match = /^diff --git a\/.+ b\/(.+)$/.exec(line);
  return match?.[1] ?? 'unknown';
}

function plusPath(line: string): string | null {
  const path = line.slice(4).trim();
  if (path === '/dev/null') return '/dev/null';
  return path.startsWith('b/') ? path.slice(2) : path;
}
