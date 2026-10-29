import { createToolCallBudgetAudit } from '../src/index.mjs';

const audit = createToolCallBudgetAudit({ maxCalls: 4, maxBatchBytes: 16_384 });
audit.observe({ id: 'call_1', name: 'lookup', argumentBytes: 96, complete: true });
audit.observe({ id: 'call_2', name: 'write', argumentBytes: 1_024, complete: true });
const report = audit.finalize({ finishReason: 'tool-calls', outputTokens: 900, maxOutputTokens: 1_000 });
console.log(JSON.stringify({ recommendation: report.recommendation, issues: report.issues.map(({ code }) => code), snapshot: report.snapshot }));
