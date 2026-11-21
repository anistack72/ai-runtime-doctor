import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { diagnoseRuntime, diagnose, localEndpoint } from './index.mjs';
import { formatReport, readJsonBody } from './support.mjs';

async function serve(t, handler) {
  const server = http.createServer(handler).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('only literal loopback or normalized localhost is accepted', () => {
  assert.equal(localEndpoint('http://localhost:1234'), 'http://127.0.0.1:1234');
  assert.equal(localEndpoint('http://[::1]:1234'), 'http://[::1]:1234');
  for (const url of ['https://example.com', 'http://127.0.0.1.evil.test', 'http://user:pass@localhost', 'http://localhost/v1', 'http://localhost/?key=a', 'file:///tmp/model']) assert.throws(() => localEndpoint(url));
});
test('reads actual Ollama-compatible HTTP fixtures without inference', async t => {
  const paths = [];
  const endpoint = await serve(t, (req, res) => {
    paths.push(req.url);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ models: req.url === '/api/tags' ? [{ name: 'test-model', size: 1024, details: { family: 'test', quantization_level: 'Q4' } }] : [] }));
  });
  const report = await diagnoseRuntime({ endpoint });
  assert.equal(report.models[0].name, 'test-model');
  assert.equal(report.checks.filter(c => c.status === 'pass').length, 4);
  assert.deepEqual(paths, ['/api/tags', '/api/ps']);
});
test('LM Studio model schema is supported', async () => {
  const report = await diagnoseRuntime({ runtime: 'lmstudio', fetchImpl: async () => Response.json({ data: [{ id: 'local-model' }] }) });
  assert.equal(report.models[0].name, 'local-model');
});
test('an empty model list is a warning, not a fabricated success', async () => {
  const report = await diagnoseRuntime({ runtime: 'lmstudio', fetchImpl: async () => Response.json({ data: [] }) });
  assert.ok(report.checks.some(c => c.id.endsWith('.models') && c.status === 'warn'));
});
test('malformed schemas and JSON become controlled findings', async () => {
  for (const response of [Response.json({ models: {} }), new Response('not json'), Response.json({ models: [null] })]) {
    const report = await diagnoseRuntime({ fetchImpl: async () => response });
    assert.equal(report.checks[0].status, 'fail');
  }
});
test('redirects are never followed outside the local boundary', async t => {
  const endpoint = await serve(t, (_, res) => { res.writeHead(302, { location: 'https://example.com' }); res.end(); });
  const report = await diagnoseRuntime({ endpoint });
  assert.equal(report.checks[0].status, 'fail');
});
test('request timeout cancels a stalled response', async t => {
  const endpoint = await serve(t, () => {});
  const report = await diagnoseRuntime({ endpoint, timeout: 30 });
  assert.equal(report.checks[0].status, 'fail');
  assert.match(report.checks[0].message, /timed out/);
});
test('oversized bodies are rejected while streaming', async () => {
  await assert.rejects(readJsonBody(new Response('a'.repeat(4096)), 100), /size limit/);
});
test('optional running-model endpoint failure keeps model inventory', async () => {
  const report = await diagnoseRuntime({ fetchImpl: async url => url.endsWith('/api/ps') ? new Response('', { status: 404 }) : Response.json({ models: [{ name: 'a' }] }) });
  assert.equal(report.models.length, 1);
  assert.ok(report.checks.some(c => c.id === 'ollama.loaded' && c.status === 'warn'));
});
test('auto-discovery succeeds when one runtime is installed', async () => {
  const report = await diagnose({ fetchImpl: async url => url.includes('11434') ? Response.json({ models: [] }) : Promise.reject(new Error('offline')) });
  assert.equal(report.checks.some(c => c.status === 'fail'), false);
});
test('HTML reports escape untrusted model and diagnostic strings', () => {
  const output = formatReport({ tool: '<script>', checks: [{ id: 'a', status: 'fail', message: '<img src=x onerror=alert(1)>' }] }, 'html');
  assert.ok(!output.includes('<script>'));
  assert.ok(output.includes('&lt;img'));
});
test('invalid runtime, endpoint combinations and timeouts fail early', async () => {
  await assert.rejects(diagnose({ runtime: 'other' }));
  await assert.rejects(diagnose({ endpoint: 'http://localhost' }));
  await assert.rejects(diagnoseRuntime({ timeout: 0 }));
});
