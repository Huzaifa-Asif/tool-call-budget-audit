'use strict';

function positiveInteger(value, name, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}
function ratio(value, name, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) throw new TypeError(`${name} must be greater than 0 and at most 1`);
  return value;
}
function record(value) {
  try { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  catch { return false; }
}

function readObservation(raw) {
  try { return { ok: true, id: raw.id, name: raw.name, bytes: raw.argumentBytes, complete: raw.complete }; }
  catch { return { ok: false }; }
}

function readFinalEvidence(raw) {
  try { return { ok: true, finishReason: raw.finishReason, outputTokens: raw.outputTokens, maxOutputTokens: raw.maxOutputTokens }; }
  catch { return { ok: false }; }
}

function createToolCallBudgetAudit(options = {}) {
  if (!record(options)) throw new TypeError('options must be an object');
  const maxCalls = positiveInteger(options.maxCalls, 'maxCalls', 16);
  const maxArgumentBytes = positiveInteger(options.maxArgumentBytes, 'maxArgumentBytes', 32_768);
  const maxBatchBytes = positiveInteger(options.maxBatchBytes, 'maxBatchBytes', 65_536);
  const maxIssues = positiveInteger(options.maxIssues, 'maxIssues', 1_000);
  const maxIdLength = positiveInteger(options.maxIdLength, 'maxIdLength', 128);
  const warningRatio = ratio(options.warningRatio, 'warningRatio', 0.9);
  const ids = new Set();
  const issues = [];
  let callCount = 0;
  let completeCalls = 0;
  let argumentBytes = 0;
  let totalIssues = 0;
  let droppedIssues = 0;
  let errorIssues = 0;
  let warningIssues = 0;
  let droppedCalls = 0;
  let finalized = false;

  function retain(code, message, detail = {}, severity = 'error') {
    totalIssues += 1;
    if (severity === 'warning') warningIssues += 1; else errorIssues += 1;
    const issue = Object.freeze({ code, severity, call: callCount, message, ...detail });
    if (issues.length < maxIssues) issues.push(issue); else droppedIssues += 1;
    return issue;
  }

  function snapshot() {
    return Object.freeze({ callCount, completeCalls, incompleteCalls: callCount - completeCalls, argumentBytes, droppedCalls, issueCount: totalIssues, errorIssueCount: errorIssues, warningIssueCount: warningIssues, retainedIssueCount: issues.length, droppedIssues, finalized });
  }

  function observe(raw) {
    if (finalized) throw new Error('audit is finalized');
    if (!record(raw)) return Object.freeze({ status: 'rejected', issues: Object.freeze([retain('invalid-call', 'tool call must be an object')]), snapshot: snapshot() });
    const normalized = readObservation(raw);
    if (!normalized.ok) return Object.freeze({ status: 'rejected', issues: Object.freeze([retain('invalid-call-access', 'tool call properties could not be read safely')]), snapshot: snapshot() });
    const { id, name, bytes, complete } = normalized;
    if (id !== undefined && (typeof id !== 'string' || id.length < 1 || id.length > maxIdLength)) return Object.freeze({ status: 'rejected', issues: Object.freeze([retain('invalid-id', 'id must be a non-empty string within maxIdLength')]), snapshot: snapshot() });
    if (typeof name !== 'string' || name.length < 1 || name.length > maxIdLength) return Object.freeze({ status: 'rejected', issues: Object.freeze([retain('invalid-name', 'name must be a non-empty string within maxIdLength')]), snapshot: snapshot() });
    if (!Number.isSafeInteger(bytes) || bytes < 0) return Object.freeze({ status: 'rejected', issues: Object.freeze([retain('invalid-argument-bytes', 'argumentBytes must be a non-negative safe integer')]), snapshot: snapshot() });
    if (typeof complete !== 'boolean') return Object.freeze({ status: 'rejected', issues: Object.freeze([retain('invalid-complete', 'complete must be a boolean')]), snapshot: snapshot() });

    if (callCount >= maxCalls) {
      if (droppedCalls < Number.MAX_SAFE_INTEGER) droppedCalls += 1;
      return Object.freeze({ status: 'rejected', issues: Object.freeze([retain('call-count-exceeded', 'tool-call batch exceeds maxCalls', { limit: maxCalls })]), snapshot: snapshot() });
    }
    if (bytes > Number.MAX_SAFE_INTEGER - argumentBytes) {
      return Object.freeze({ status: 'rejected', issues: Object.freeze([retain('argument-bytes-overflow', 'cumulative argument bytes would exceed the safe integer range')]), snapshot: snapshot() });
    }

    callCount += 1;
    argumentBytes += bytes;
    if (complete) completeCalls += 1;
    const found = [];
    if (id !== undefined) {
      if (ids.has(id)) found.push(retain('duplicate-id', 'tool call id was already observed', { id }));
      else ids.add(id);
    }
    if (bytes > maxArgumentBytes) found.push(retain('argument-bytes-exceeded', 'tool-call argument bytes exceed the per-call limit', { argumentBytes: bytes, limit: maxArgumentBytes }));
    if (argumentBytes > maxBatchBytes) found.push(retain('batch-bytes-exceeded', 'tool-call argument bytes exceed the batch limit', { argumentBytes, limit: maxBatchBytes }));
    if (!complete) found.push(retain('incomplete-arguments', 'tool-call arguments are not complete'));
    return Object.freeze({ status: 'accepted', issues: Object.freeze(found), snapshot: snapshot() });
  }

  function finalize(raw = {}) {
    if (finalized) return Object.freeze({ valid: errorIssues === 0, recommendation: errorIssues > 0 ? 'reject' : warningIssues > 0 ? 'review' : 'proceed', issues: Object.freeze([...issues]), snapshot: snapshot() });
    if (!record(raw)) throw new TypeError('final result must be an object');
    const normalized = readFinalEvidence(raw);
    if (!normalized.ok) {
      retain('invalid-final-evidence-access', 'final evidence properties could not be read safely');
      finalized = true;
      return Object.freeze({ valid: false, recommendation: 'reject', issues: Object.freeze([...issues]), snapshot: snapshot() });
    }
    const { finishReason, outputTokens, maxOutputTokens } = normalized;
    if (finishReason !== undefined && typeof finishReason !== 'string') retain('invalid-finish-reason', 'finishReason must be a string when supplied');
    if (outputTokens !== undefined && (!Number.isSafeInteger(outputTokens) || outputTokens < 0)) retain('invalid-output-tokens', 'outputTokens must be a non-negative safe integer');
    if (maxOutputTokens !== undefined && (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1)) retain('invalid-max-output-tokens', 'maxOutputTokens must be a positive safe integer');
    if (Number.isSafeInteger(outputTokens) && outputTokens >= 0 && Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0) {
      const usedRatio = outputTokens / maxOutputTokens;
      if (usedRatio >= warningRatio) retain('output-budget-near-limit', 'reported output usage is near or above the configured output-token budget', { outputTokens, maxOutputTokens, usedRatio }, 'warning');
      if (outputTokens > maxOutputTokens) retain('output-budget-exceeded', 'reported output usage exceeds maxOutputTokens', { outputTokens, maxOutputTokens });
    }
    if (finishReason === 'length' && callCount > 0) retain('length-finish-with-tool-calls', 'length finish reason makes the tool-call batch truncation-prone', {}, 'warning');
    if (finishReason === 'length' && completeCalls < callCount) retain('length-finish-with-incomplete-call', 'length finish reason occurred with incomplete tool-call arguments');
    finalized = true;
    return Object.freeze({ valid: errorIssues === 0, recommendation: errorIssues > 0 ? 'reject' : warningIssues > 0 ? 'review' : 'proceed', issues: Object.freeze([...issues]), snapshot: snapshot() });
  }

  return Object.freeze({ observe, snapshot, finalize });
}

module.exports = { createToolCallBudgetAudit };
