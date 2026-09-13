const { spawnSync } = require('node:child_process');
const { resolvePackageBin } = require('./package-bin.cjs');

const viteBin = resolvePackageBin('vite');
const result = spawnSync(process.execPath, [viteBin, '--version'], {
  encoding: 'utf8',
  env: process.env,
  timeout: 10_000,
});

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'Vite smoke check failed.\n');
  process.exit(result.status || 1);
}

process.stdout.write(`Desktop dev launcher resolved Vite successfully: ${(result.stdout || result.stderr || '').trim()}\n`);
