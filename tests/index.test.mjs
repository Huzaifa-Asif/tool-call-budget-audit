import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import esm, { createToolCallBudgetAudit } from '../src/index.mjs';
const require = createRequire(import.meta.url);
const cjs = require('../src/index.cjs');

test('ESM and CommonJS expose the same API', () => assert.deepEqual(Object.keys(esm), Object.keys(cjs)));
test('accepts a complete batch within limits', () => {
  const audit = createToolCallBudgetAudit();
  assert.equal(audit.observe({ id: '1', name: 'weather', argumentBytes: 42, complete: true }).status, 'accepted');
  const report = audit.finalize({ finishReason: 'tool-calls', outputTokens: 100, maxOutputTokens: 1000 });
  assert.equal(report.valid, true); assert.equal(report.recommendation, 'proceed');
});
test('rejects count and byte limit violations', () => {
  const audit = createToolCallBudgetAudit({ maxCalls: 1, maxArgumentBytes: 5, maxBatchBytes: 6 });
  audit.observe({ name: 'a', argumentBytes: 4, complete: true });
  const result = audit.observe({ name: 'b', argumentBytes: 6, complete: true });
  assert.equal(result.status, 'rejected');
  assert.deepEqual(result.issues.map(({ code }) => code), ['call-count-exceeded']);
  assert.equal(result.snapshot.callCount, 1);
  assert.equal(result.snapshot.droppedCalls, 1);
  assert.equal(audit.finalize().recommendation, 'reject');
});
test('bounds retained ids and processed calls after maxCalls', () => {
  const audit = createToolCallBudgetAudit({ maxCalls: 1, maxIssues: 2 });
  audit.observe({ id: 'first', name: 'a', argumentBytes: 1, complete: true });
  for (let index = 0; index < 10_000; index += 1) audit.observe({ id: `later-${index}`, name: 'b', argumentBytes: 1, complete: true });
  assert.equal(audit.snapshot().callCount, 1);
  assert.equal(audit.snapshot().droppedCalls, 10_000);
  assert.equal(audit.observe({ id: 'later-9999', name: 'b', argumentBytes: 1, complete: true }).issues[0].code, 'call-count-exceeded');
});
test('rejects cumulative byte overflow without mutating counters', () => {
  const audit = createToolCallBudgetAudit({ maxCalls: 2, maxArgumentBytes: Number.MAX_SAFE_INTEGER, maxBatchBytes: Number.MAX_SAFE_INTEGER });
  audit.observe({ name: 'a', argumentBytes: Number.MAX_SAFE_INTEGER, complete: true });
  const result = audit.observe({ name: 'b', argumentBytes: 1, complete: true });
  assert.equal(result.issues[0].code, 'argument-bytes-overflow');
  assert.equal(result.snapshot.argumentBytes, Number.MAX_SAFE_INTEGER);
  assert.equal(result.snapshot.callCount, 1);
});
test('counts a post-ceiling call before considering aggregate overflow', () => {
  const audit = createToolCallBudgetAudit({ maxCalls: 1, maxArgumentBytes: Number.MAX_SAFE_INTEGER, maxBatchBytes: Number.MAX_SAFE_INTEGER });
  audit.observe({ name: 'a', argumentBytes: Number.MAX_SAFE_INTEGER, complete: true });
  const result = audit.observe({ name: 'b', argumentBytes: 1, complete: true });
  assert.equal(result.issues[0].code, 'call-count-exceeded');
  assert.equal(result.snapshot.droppedCalls, 1);
  assert.equal(result.snapshot.argumentBytes, Number.MAX_SAFE_INTEGER);
});
test('contains throwing getters and revoked proxies', () => {
  const audit = createToolCallBudgetAudit();
  const throwing = { get id() { throw new Error('boom'); }, name: 'a', argumentBytes: 0, complete: true };
  assert.equal(audit.observe(throwing).issues[0].code, 'invalid-call-access');
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  assert.equal(audit.observe(proxy).issues[0].code, 'invalid-call');
  const report = audit.finalize({ get finishReason() { throw new Error('boom'); } });
  assert.equal(report.issues.at(-1).code, 'invalid-final-evidence-access');
  assert.equal(report.recommendation, 'reject');
});
test('reports duplicate ids without retaining arguments', () => {
  const audit = createToolCallBudgetAudit();
  audit.observe({ id: 'x', name: 'one', argumentBytes: 1, complete: true });
  assert.equal(audit.observe({ id: 'x', name: 'two', argumentBytes: 1, complete: true }).issues[0].code, 'duplicate-id');
});
test('reports incomplete arguments', () => {
  const audit = createToolCallBudgetAudit();
  const result = audit.observe({ name: 'write', argumentBytes: 100, complete: false });
  assert.equal(result.issues[0].code, 'incomplete-arguments');
  assert.equal(result.snapshot.incompleteCalls, 1);
});
test('warns when usage approaches output budget', () => {
  const audit = createToolCallBudgetAudit({ warningRatio: 0.8 });
  audit.observe({ name: 'a', argumentBytes: 1, complete: true });
  const report = audit.finalize({ outputTokens: 80, maxOutputTokens: 100 });
  assert.equal(report.valid, true); assert.equal(report.recommendation, 'review');
  assert.equal(report.issues[0].code, 'output-budget-near-limit');
});
test('rejects reported usage above budget', () => {
  const report = createToolCallBudgetAudit().finalize({ outputTokens: 101, maxOutputTokens: 100 });
  assert.equal(report.valid, false); assert.equal(report.recommendation, 'reject');
  assert.deepEqual(report.issues.map(({ code }) => code), ['output-budget-near-limit', 'output-budget-exceeded']);
});
test('classifies length finish with complete calls as review', () => {
  const audit = createToolCallBudgetAudit();
  audit.observe({ name: 'a', argumentBytes: 1, complete: true });
  const report = audit.finalize({ finishReason: 'length' });
  assert.equal(report.recommendation, 'review');
  assert.equal(report.issues[0].code, 'length-finish-with-tool-calls');
});
test('rejects length finish with incomplete calls', () => {
  const audit = createToolCallBudgetAudit();
  audit.observe({ name: 'a', argumentBytes: 1, complete: false });
  const report = audit.finalize({ finishReason: 'length' });
  assert.equal(report.recommendation, 'reject');
  assert.equal(report.issues.some(({ code }) => code === 'length-finish-with-incomplete-call'), true);
});
test('validates observations without mutating counters', () => {
  const audit = createToolCallBudgetAudit({ maxIdLength: 3 });
  for (const [value, code] of [[null, 'invalid-call'], [{ name: '', argumentBytes: 0, complete: true }, 'invalid-name'], [{ name: 'ok', argumentBytes: -1, complete: true }, 'invalid-argument-bytes'], [{ name: 'ok', argumentBytes: 0, complete: null }, 'invalid-complete'], [{ id: 'long', name: 'ok', argumentBytes: 0, complete: true }, 'invalid-id']]) {
    assert.equal(audit.observe(value).issues[0].code, code);
  }
  assert.equal(audit.snapshot().callCount, 0);
});
test('validates options and final evidence', () => {
  assert.throws(() => createToolCallBudgetAudit(null), /options/);
  assert.throws(() => createToolCallBudgetAudit({ maxCalls: 0 }), /positive/);
  assert.throws(() => createToolCallBudgetAudit({ warningRatio: 2 }), /at most 1/);
  const audit = createToolCallBudgetAudit();
  const report = audit.finalize({ finishReason: 1, outputTokens: -1, maxOutputTokens: 0 });
  assert.deepEqual(report.issues.map(({ code }) => code), ['invalid-finish-reason', 'invalid-output-tokens', 'invalid-max-output-tokens']);
});
test('bounds retained diagnostics', () => {
  const audit = createToolCallBudgetAudit({ maxIssues: 1 });
  audit.observe({ name: 'a', argumentBytes: 1, complete: false });
  audit.observe({ name: 'b', argumentBytes: 1, complete: false });
  assert.equal(audit.snapshot().retainedIssueCount, 1); assert.equal(audit.snapshot().droppedIssues, 1);
});
test('finalize is idempotent and seals observations', () => {
  const audit = createToolCallBudgetAudit();
  const first = audit.finalize();
  assert.deepEqual(audit.finalize({ finishReason: 'length' }), first);
  assert.throws(() => audit.observe({ name: 'x', argumentBytes: 0, complete: true }), /finalized/);
});
test('returns frozen reports and snapshots', () => {
  const result = createToolCallBudgetAudit().observe({ name: 'x', argumentBytes: 0, complete: true });
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.snapshot), true); assert.equal(Object.isFrozen(result.issues), true);
});
