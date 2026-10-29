# tool-call-budget-audit

Audit a generated tool-call batch for count, serialized argument bytes, incomplete arguments, duplicate IDs, and output-budget/finish-reason risk. The package is deterministic, bounded, zero-dependency, and ships ESM, CommonJS, and TypeScript entry points.

It does **not** estimate provider tokens, parse tool arguments, execute tools, stop an agent loop, or modify a transcript.

## Why

A tool-call batch can be structurally valid yet still be risky: too many calls, oversized arguments, incomplete JSON at a `length` finish, or reported output usage already near the configured budget. Applications often see these facts only after generation and need a provider-neutral way to decide whether to execute, review, or reject the batch.

Current public evidence includes:

- [Vercel AI #22921](https://github.com/vercel/ai/issues/22921) (2026-10-11): no provider-neutral warning when a tool-call batch approaches or exhausts the output budget; a credential-free reproduction produced two calls at the full configured output-token budget without a warning.
- [Vercel AI #22920](https://github.com/vercel/ai/issues/22920) (2026-10-11): provider-neutral per-step call limits require explicit transcript, finish-reason, retry, and side-effect semantics.
- [Vercel AI #22912](https://github.com/vercel/ai/issues/22912) (2026-10-11): calls skipped after a non-success finish can remain unresolved and poison later history.
- [Vercel AI #12949](https://github.com/vercel/ai/issues/12949) (2026-02-28): large batched tool-call arguments can create long silent streaming intervals and transport failure.

These reports motivate observable local policy. They do not establish demand for this exact package or make byte counts equivalent to tokens.

## Install

```sh
npm install tool-call-budget-audit
```

Requires Node.js 20 or newer.

## Quick start

```js
import { createToolCallBudgetAudit } from 'tool-call-budget-audit';

const audit = createToolCallBudgetAudit({
  maxCalls: 8,
  maxArgumentBytes: 16_384,
  maxBatchBytes: 32_768,
});

for (const call of generatedCalls) {
  audit.observe({
    id: call.id,
    name: call.name,
    argumentBytes: Buffer.byteLength(call.arguments, 'utf8'),
    complete: call.argumentsComplete,
  });
}

const report = audit.finalize({
  finishReason,
  outputTokens: usage.outputTokens,
  maxOutputTokens: configuredMaxOutputTokens,
});

if (report.recommendation === 'reject') quarantineBatch(report);
```

CommonJS:

```js
const { createToolCallBudgetAudit } = require('tool-call-budget-audit');
```

## API

### `createToolCallBudgetAudit(options?)`

- `maxCalls`: default `16`.
- `maxArgumentBytes`: per-call limit, default `32_768`.
- `maxBatchBytes`: cumulative argument limit, default `65_536`.
- `warningRatio`: reported output-token warning threshold, default `0.9`.
- `maxIssues`: retained diagnostic limit, default `1_000`.
- `maxIdLength`: ID/name length limit, default `128`.

### `audit.observe(call)`

Each observation contains `name`, non-negative `argumentBytes`, boolean `complete`, and optional `id`. The auditor processes and retains at most `maxCalls` IDs; later observations are rejected and counted in the saturating `droppedCalls` field. It never receives or stores argument content. Unsafe property access and cumulative byte-count overflow are rejected without mutating accepted-call counters.

### `audit.finalize(evidence?)`

Optional evidence includes `finishReason`, `outputTokens`, and `maxOutputTokens`. The immutable report returns:

- `valid`: no error-severity issue occurred.
- `recommendation`: `proceed`, `review`, or `reject`.
- bounded issues and a metadata-only snapshot.

Warnings such as near-budget usage or a complete batch ending with `length` require review. Incomplete calls, exceeded hard limits, duplicate IDs, invalid evidence, or reported usage above the budget reject the batch.

## Issue codes

`call-count-exceeded`, `argument-bytes-exceeded`, `batch-bytes-exceeded`, `argument-bytes-overflow`, `incomplete-arguments`, `duplicate-id`, `output-budget-near-limit`, `output-budget-exceeded`, `length-finish-with-tool-calls`, `length-finish-with-incomplete-call`, and validation codes.

## Runtime and integration guidance

- Measure the exact serialized argument bytes that would be sent to the tool executor; use UTF-8 bytes, not JavaScript string length.
- Feed only a final call once. Streaming adapters should accumulate their own byte count and completeness state.
- Treat the recommendation as evidence for application policy. Check authorization, side effects, idempotency, cost, and user intent separately.
- Run the audit before tool execution. It cannot undo a side effect.
- Keep provider finish reasons unchanged when possible; mappings must be documented by the adapter.

## Alternatives and distinctness

- Provider SDK warnings are preferable when available and contractual. Issue #22921 documents the current provider-neutral gap.
- Step-count limits stop long loops; they do not inspect one generated batch.
- `size-limit` measures build artifacts, not tool calls.
- `@convex-dev/ai-budget` governs spend and rate limits, not per-batch call structure.
- DeepSeek Harness spill and repeat plugins handle tool-result size or repeated loops, not the output-budget evidence of a single call batch.
- `tool-call-closure` audits call/result pairing. `tool-call-budget-audit` deliberately stops before execution and does not synthesize results.
- MCP Catalog Budget Lab measures saved tool-catalog definition footprint. This package measures generated call metadata and never reads a catalog.

## Limitations

- Bytes are not tokens. Provider tokenization and serialization overhead vary.
- Reported token usage may be absent, delayed, estimated, or provider-specific.
- A complete argument string may still be invalid JSON or fail its schema.
- A batch inside every configured limit can still be unsafe, expensive, unauthorized, or semantically wrong.
- Duplicate detection is by supplied ID only; semantic duplicate calls are outside scope.
- The package does not retain payloads, so it cannot produce argument excerpts or repair malformed calls.

## Troubleshooting

- `length-finish-with-tool-calls`: inspect every call for truncation before execution.
- `incomplete-arguments`: do not execute; wait for a complete stream or fail the batch.
- `output-budget-near-limit`: review rather than assuming truncation; bytes and tokens are different.
- `batch-bytes-exceeded`: reduce tool argument surface or split the task under an application-owned policy.
- `duplicate-id`: reject or remap at the adapter boundary; IDs must remain unique within the audited batch.

## Security

Pass byte counts and metadata, never secrets or raw arguments. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
