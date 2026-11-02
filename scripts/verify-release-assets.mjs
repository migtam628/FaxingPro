// Fail-closed integrity check for the complete set of published FaxingPro assets.
// Checks file names, completeness, SHA-256 digests and nonempty regular files.
// Does not assert code signing, notarization, provenance or runtime correctness.
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export function releaseAssetNames(version = packageVersion) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Invalid package version');
  }
  return [
    `FaxingPro-${version}-win-x64.exe`,
    `FaxingPro-${version}-mac-x64.dmg`,
    `FaxingPro-${version}-mac-arm64.dmg`,
    `FaxingPro-${version}-linux-x86_64.AppImage`,
    `FaxingPro-${version}-linux-amd64.deb`,
    'faxingpro-install.sh',
    'README.md',
    'FaxingPro-Setup-Docs.zip',
    'RELEASE_NOTES.md',
  ];
}

async function digestFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function verifyReleaseAssets(directory, version = packageVersion) {
  const expected = releaseAssetNames(version);
  const required = new Set(expected);
  const actual = readdirSync(directory, { withFileTypes: true });
  const allowed = new Set([...expected, 'SHA256SUMS']);
  for (const entry of actual) {
    if (!allowed.has(entry.name)) throw new Error(`Unexpected release asset: ${entry.name}`);
    if (!entry.isFile()) throw new Error(`Not a regular release file: ${entry.name}`);
  }
  for (const name of allowed) {
    if (!actual.some((entry) => entry.name === name)) throw new Error(`Missing release asset: ${name}`);
  }

  const manifest = readFileSync(join(directory, 'SHA256SUMS'), 'utf8');
  if (!manifest.endsWith('\n')) throw new Error('SHA256SUMS must end with a newline');
  const lines = manifest.trimEnd().split('\n');
  const checksums = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(line);
    if (!match) throw new Error('Malformed SHA256SUMS entry');
    const [, digest, name] = match;
    if (!required.has(name)) throw new Error(`Unexpected checksum entry: ${name}`);
    if (checksums.has(name)) throw new Error(`Duplicate checksum entry: ${name}`);
    checksums.set(name, digest);
  }
  for (const name of expected) {
    if (!checksums.has(name)) throw new Error(`Missing checksum entry: ${name}`);
    const path = join(directory, name);
    if (!lstatSync(path).isFile()) throw new Error(`Not a regular file: ${name}`);
    if (lstatSync(path).size === 0) throw new Error(`Empty release asset: ${name}`);
    const actualDigest = await digestFile(path);
    if (actualDigest !== checksums.get(name)) throw new Error(`SHA-256 mismatch: ${name}`);
  }
  return { verified: expected.length, version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/verify-release-assets.mjs DIRECTORY');
    process.exitCode = 2;
  } else {
    try {
      const result = await verifyReleaseAssets(process.argv[2]);
      console.log(`PASS: verified ${result.verified} complete FaxingPro ${result.version} release assets`);
    } catch (error) {
      console.error(`FAIL: release asset verification: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
