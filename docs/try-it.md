# Try AI Runtime Doctor without production data

Requires Node.js 22 or later; no dependency installation is needed.

```sh
git clone https://github.com/anistack72/ai-runtime-doctor.git
cd ai-runtime-doctor
node demo.mjs
node demo.mjs json > demo-report.json
node demo.mjs html > demo-report.html
```

The fixture server binds to an ephemeral loopback port. The JSON report contains one synthetic model and no loaded models. No installed Ollama/LM Studio service or model download is needed.

All demo output is labeled **SYNTHETIC FIXTURE DEMO**. It demonstrates the reporting path, not measured production adoption or a benchmark. Review the JSON `checks` list; demo checks should have `status: "pass"`. Open `demo-report.html` locally to inspect the standalone HTML report.

## Verify the same onboarding path

```sh
npm run check
npm test
```

`demo.test.mjs` executes the actual CLI demonstration in terminal, JSON and HTML formats. It checks that the fixture succeeds, that the JSON contract is parseable and that the HTML needs no remote script, stylesheet or iframe. Those tests also run in the existing Node 22/24 CI matrix on Linux, macOS and Windows.

For real inputs, return to the [README](../README.md) and its documented scope and limitations. Share a reproducible issue when behavior differs; omit credentials and private data.
