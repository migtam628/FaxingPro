import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('VPS preflight script passes bash syntax validation', { skip: process.platform === 'win32' }, () => {
  const result = spawnSync('bash', ['-n', 'scripts/vps-preflight.sh'], {
    encoding: 'utf8',
    timeout: 10000
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || 'bash syntax check failed');
});
