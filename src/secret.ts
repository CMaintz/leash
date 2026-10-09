// Read a secret (the API key for `leash login`) without echoing it: masked keystrokes on a
// terminal, or the whole of stdin when piped (`Get-Clipboard | leash login`).

export interface SecretInput {
  value: string;
  done: boolean;
  cancelled: boolean;
}

/** Apply one chunk of raw-mode keystrokes: Enter finishes, Ctrl-C cancels, Backspace deletes. */
export function applyKeystrokes(value: string, chunk: string): SecretInput {
  let next = value;
  for (const ch of chunk) {
    if (ch === '\u0003') return { value: '', done: true, cancelled: true };
    if (ch === '\r' || ch === '\n') return { value: next.trim(), done: true, cancelled: false };
    next = ch === '\u007f' || ch === '\b' ? next.slice(0, -1) : next + ch;
  }
  return { value: next, done: false, cancelled: false };
}

/** The secret from stdin: masked prompt on a TTY, else everything piped in. */
export async function readSecret(prompt: string, stdin: NodeJS.ReadStream = process.stdin): Promise<string> {
  if (!stdin.isTTY) return (await readAll(stdin)).trim();
  process.stdout.write(prompt);
  return readMasked(stdin);
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function readMasked(stdin: NodeJS.ReadStream): Promise<string> {
  return new Promise((resolve) => {
    let state: SecretInput = { value: '', done: false, cancelled: false };
    const onData = (chunk: string): void => {
      state = applyKeystrokes(state.value, chunk);
      if (!state.done) return;
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      resolve(state.value);
    };
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.on('data', onData).resume();
  });
}
