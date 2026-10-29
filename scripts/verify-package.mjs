import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import esm from '../src/index.mjs';
const require = createRequire(import.meta.url);
const cjs = require('../src/index.cjs');
assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
assert.deepEqual(Object.keys(esm), ['createToolCallBudgetAudit']);
console.log('ESM/CommonJS API parity verified.');
