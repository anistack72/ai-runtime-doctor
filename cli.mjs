#!/usr/bin/env node
import { diagnose } from './index.mjs';
import { options, formatReport, exitCode, clean } from './support.mjs';
try {
  const args = options({ runtime: { type: 'string', default: 'all' }, endpoint: { type: 'string' }, timeout: { type: 'string', default: '2500' }, strict: { type: 'boolean' } });
  if (args.help) console.log('AI Runtime Doctor\n\nnode cli.mjs [--runtime all|ollama|lmstudio] [--endpoint http://127.0.0.1:11434]\n  [--timeout 2500] [--format text|json|markdown|html] [--strict]\n\nRead-only, loopback-only diagnostics. Node.js >=22.');
  else {
    if (args.positionals.length) throw new Error('Unexpected positional arguments');
    const report = await diagnose(args);
    console.log(formatReport(report, args.format));
    process.exitCode = exitCode(report, args.strict);
  }
} catch (error) { console.error(`AI Runtime Doctor: ${clean(error.message)}`); process.exitCode = 2; }
