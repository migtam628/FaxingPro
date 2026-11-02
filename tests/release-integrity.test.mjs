import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { releaseAssetNames, verifyReleaseAssets } from '../scripts/verify-release-assets.mjs';

const version = '0.1.0';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'faxingpro-release-integrity-'));
  const names = releaseAssetNames(version);
  for (const name of names) writeFileSync(join(dir, name), `synthetic test asset: ${name}\n`);
  const manifest = names.map((name) => {
    const hash = createHash('sha256').update(readFileSync(join(dir, name))).digest('hex');
    return `${hash}  ${name}`;
  }).join('\n') + '\n';
  writeFileSync(join(dir, 'SHA256SUMS'), manifest);
  return { dir, names, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('accepts complete multi-platform release assets with matching digests', async () => {
  const f = fixture();
  try {
    assert.deepEqual(await verifyReleaseAssets(f.dir, version), { verified: 9, version });
  } finally { f.cleanup(); }
});

test('rejects a missing macOS architecture even if the manifest still lists it', async () => {
  const f = fixture();
  try {
    unlinkSync(join(f.dir, `FaxingPro-${version}-mac-arm64.dmg`));
    await assert.rejects(verifyReleaseAssets(f.dir, version), /Missing release asset/);
  } finally { f.cleanup(); }
});

test('rejects tampered installer bytes after checksum generation', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, `FaxingPro-${version}-win-x64.exe`), 'tampered');
    await assert.rejects(verifyReleaseAssets(f.dir, version), /SHA-256 mismatch/);
  } finally { f.cleanup(); }
});

test('rejects a missing checksum for a required installer', async () => {
  const f = fixture();
  try {
    const manifestPath = join(f.dir, 'SHA256SUMS');
    const lines = readFileSync(manifestPath, 'utf8').trim().split('\n');
    writeFileSync(manifestPath, lines.slice(1).join('\n') + '\n');
    await assert.rejects(verifyReleaseAssets(f.dir, version), /Missing checksum entry/);
  } finally { f.cleanup(); }
});

test('rejects duplicate manifest entries and path traversal', async () => {
  const f = fixture();
  try {
    const path = join(f.dir, 'SHA256SUMS');
    const manifest = readFileSync(path, 'utf8');
    writeFileSync(path, manifest + manifest.split('\n')[0] + '\n');
    await assert.rejects(verifyReleaseAssets(f.dir, version), /Duplicate checksum entry/);
    writeFileSync(path, manifest + '0'.repeat(64) + '  ../secret\n');
    await assert.rejects(verifyReleaseAssets(f.dir, version), /Malformed SHA256SUMS entry/);
  } finally { f.cleanup(); }
});

test('rejects unlisted release assets and zero-byte documentation', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, 'unexpected.exe'), 'not in manifest');
    await assert.rejects(verifyReleaseAssets(f.dir, version), /Unexpected release asset/);
    unlinkSync(join(f.dir, 'unexpected.exe'));
    writeFileSync(join(f.dir, 'README.md'), '');
    await assert.rejects(verifyReleaseAssets(f.dir, version), /Empty release asset/);
  } finally { f.cleanup(); }
});
