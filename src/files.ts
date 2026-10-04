// Tiny file helpers shared by the installers that drop a generated file into a host's
// config dir (the /leash-rubric command, the OpenCode plugin).

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Write `content` to `path`, creating parent dirs. Returns the path. */
export function writeFileEnsuringDir(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

/** Remove `path` if present. Returns the path whether or not it existed. */
export function removeIfExists(path: string): string {
  if (existsSync(path)) rmSync(path);
  return path;
}
