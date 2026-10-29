import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['src/index.cjs', 'src/index.mjs', 'tests/index.test.mjs', 'examples/audit-batch.mjs', ...readdirSync('scripts').filter((x) => x.endsWith('.mjs')).map((x) => `scripts/${x}`)];
for (const file of files) { const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status ?? 1); }
console.log(`Syntax checked ${files.length} JavaScript files.`);
