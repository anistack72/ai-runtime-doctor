import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { clean, integer, readJsonBody } from './support.mjs';

export function localEndpoint(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Invalid endpoint URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use a root HTTP(S) endpoint without credentials, query or fragment');
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Only loopback endpoints are supported');
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.origin;
}

function modelsFrom(data, runtime) {
  const list = runtime === 'ollama' ? data.models : data.data;
  if (!Array.isArray(list)) throw new Error('Unexpected model-list schema');
  return list.map(model => {
    const name = runtime === 'ollama' ? model?.name : model?.id;
    if (typeof name !== 'string' || !name.trim()) throw new Error('Model list contains an invalid name');
    return {
      name: clean(name),
      sizeBytes: Number.isSafeInteger(model.size) && model.size >= 0 ? model.size : null,
      family: typeof model.details?.family === 'string' ? clean(model.details.family) : null,
      quantization: typeof model.details?.quantization_level === 'string' ? clean(model.details.quantization_level) : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function diagnoseRuntime({ runtime = 'ollama', endpoint, timeout = 2500, fetchImpl = fetch } = {}) {
  if (!['ollama', 'lmstudio'].includes(runtime)) throw new Error('runtime must be ollama or lmstudio');
  const base = localEndpoint(endpoint ?? (runtime === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234'));
  timeout = integer(timeout, 'timeout', 1, 60000);
  const start = performance.now();
  const checks = [];
  const result = { runtime, endpoint: base, models: [], runningModels: [], latencyMs: null, checks };
  async function request(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(base + path, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
      return await readJsonBody(response);
    } finally { clearTimeout(timer); }
  }
  try {
    const data = await request(runtime === 'ollama' ? '/api/tags' : '/v1/models');
    result.models = modelsFrom(data, runtime);
    result.latencyMs = Math.round(performance.now() - start);
    checks.push({ id: `${runtime}.connection`, status: 'pass', message: `Model-list endpoint responded in ${result.latencyMs} ms. This is not inference latency.` });
    checks.push({ id: `${runtime}.models`, status: result.models.length ? 'pass' : 'warn', message: result.models.length ? `${result.models.length} model(s) available to the server.` : 'The server is reachable but its model list is empty. Check model installation and server configuration.' });
    for (const [index,model] of result.models.entries()) checks.push({id:`${runtime}.model.${index+1}`,status:'pass',message:`${model.name}${model.sizeBytes!==null ? ' · '+model.sizeBytes+' bytes' : ''}${model.quantization ? ' · '+model.quantization : ''}`});
  } catch (error) {
    checks.push({ id: `${runtime}.connection`, status: 'fail', message: `Could not read the model list (${clean(error.name === 'AbortError' ? 'request timed out' : error.message)}). Check that the local service is running and its API is accessible.` });
    return result;
  }
  if (runtime === 'ollama') {
    try {
      const data = await request('/api/ps');
      if (!Array.isArray(data.models)) throw new Error('Unexpected running-model schema');
      result.runningModels = data.models.map(m => ({ name: clean(m.name), vramBytes: Number.isSafeInteger(m.size_vram) && m.size_vram >= 0 ? m.size_vram : null, contextLength: Number.isSafeInteger(m.context_length) && m.context_length > 0 ? m.context_length : null }));
      checks.push({ id: 'ollama.loaded', status: 'pass', message: `${result.runningModels.length} model(s) currently loaded. An empty list is normal when idle.` });
    } catch {
      checks.push({ id: 'ollama.loaded', status: 'warn', message: 'The running-model endpoint could not be read. Installed-model results remain available.' });
    }
  }
  return result;
}

export async function diagnose({ runtime = 'all', endpoint, timeout, fetchImpl } = {}) {
  if (!['all', 'ollama', 'lmstudio'].includes(runtime)) throw new Error('runtime must be all, ollama or lmstudio');
  if (runtime === 'all' && endpoint) throw new Error('A custom endpoint requires a specific runtime');
  const runtimes = await Promise.all((runtime === 'all' ? ['ollama', 'lmstudio'] : [runtime]).map(r => diagnoseRuntime({ runtime: r, endpoint, timeout, fetchImpl })));
  const available = runtimes.filter(r => r.checks.some(c => c.id.endsWith('.connection') && c.status === 'pass'));
  // Auto-discovery does not fail merely because the other supported server is absent.
  const checks = runtimes.flatMap(r => r.checks.map(c => runtime === 'all' && available.length && c.status === 'fail' ? { ...c, status: 'warn', message: c.message + ' Optional discovery target.' } : c));
  return { schemaVersion: 1, tool: 'AI Runtime Doctor', generatedAt: new Date().toISOString(), summary: `${available.length}/${runtimes.length} local runtime(s) available. No inference requests, downloads or prompts were sent.`, host: { platform: os.platform(), arch: os.arch(), totalMemoryBytes: os.totalmem() }, checks, runtimes };
}
