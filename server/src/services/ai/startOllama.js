import { spawn } from 'node:child_process';

// Optional project-specific runner, isolated from the user's normal Ollama instance.
export async function ensureLocalOllama() {
  if (!process.env.OLLAMA_EXECUTABLE || !process.env.OLLAMA_MODEL) return;
  const base = new URL(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) return;
  const ready = async () => {
    try { return (await fetch(new URL('/api/version', base), { signal: AbortSignal.timeout(500) })).ok; }
    catch { return false; }
  };
  if (await ready()) return;
  const child = spawn(process.env.OLLAMA_EXECUTABLE, ['serve'], {
    detached: true, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, OLLAMA_HOST: base.host, OLLAMA_VULKAN: 'false', OLLAMA_NUM_PARALLEL: '1' },
  });
  let failed = false;
  child.on('error', () => { failed = true; });
  child.unref();
  for (let attempt = 0; attempt < 24 && !failed; attempt++) {
    if (await ready()) { console.log(`Local Ollama ready at ${base.origin}`); return; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  console.warn('Local Ollama did not start. Cash Copilot will use its calculated fallback.');
}
