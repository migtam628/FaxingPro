import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const filename of [
  'scripts/vps-preflight.sh',
  'scripts/build-freeswitch-image.sh',
]) {
  test(`${filename} passes bash syntax validation`, { skip: process.platform === 'win32' }, () => {
    const result = spawnSync('bash', ['-n', filename], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr || 'bash syntax check failed');
  });
}
