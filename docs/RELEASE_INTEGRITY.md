# FaxingPro ATLAS — release asset integrity (preview milestone)

This milestone closes a gap in issue #3: the previous post-publication job checked the installer script and documentation but **did not download and hash the five published desktop installers**. A successful job therefore did not establish that Windows, both macOS architectures and both Linux packages were present and unchanged.

## What CI now verifies

The release workflow runs `node scripts/verify-release-assets.mjs release-files` **before** creating a GitHub Release, then downloads **every published release asset** and runs the same validator again. Both checks must pass for the workflow to succeed.

The validator requires exactly ten files: five desktop installers (Windows x64 EXE, macOS x64 DMG, macOS arm64 DMG, Linux x86_64 AppImage and Linux amd64 DEB), the guided VPS installer, README, setup documentation ZIP, release notes, and SHA256SUMS. The nine non-manifest files must each be nonempty regular files with exactly one correctly formatted SHA-256 entry matching their actual bytes. Missing or extra assets, duplicate/malformed entries, checksum mismatches and directory entries masquerading as files cause failure.

The existing published-release job also checks installer shell syntax and its synthetic self-test, the documentation ZIP's integrity and required files, and consistency between the README and release notes. These are **automated packaging checks**, not real desktop installation tests.

## Local verification

After downloading all ten assets from **one specific release** into a dedicated directory, from the matching repository checkout run:

```bash
node scripts/verify-release-assets.mjs /path/to/downloaded-release
```

The script reads the expected application version from `package.json` in that checkout. Do not mix assets from different release versions. Run `npm test` for synthetic regression cases covering altered bytes, missing architecture, missing or duplicate checksums, malformed paths, extra files and empty files.

## Security and remaining gates

- A SHA-256 manifest and its binaries hosted on the **same mutable release** are not independent publisher authentication. An attacker with release-edit access could replace both. Do not describe this as signed provenance.
- Desktop packages are still **unsigned** and macOS binaries are **not notarized**. No Windows SmartScreen/macOS Gatekeeper acceptance, installer/uninstaller behavior, native OS smoke test, secure auto-update, dependency vulnerability audit or artifact attestation is proven by this change.
- The source-code release archives GitHub generates automatically are not uploaded release assets and are not part of the ten-file manifest.
- If post-publication verification fails, the workflow must show a failure even though the release was already published. Operators should investigate/quarantine the affected preview and not promote it. The workflow does **not** delete releases or overwrite artifacts automatically.
- Stable production distribution remains gated on code signing/notarization, installation tests, release provenance, dependency checks, and the service's independent production acceptance criteria. Preview releases are not production certification.

Related: [desktop release issue #3](https://github.com/migtam628/FaxingPro/issues/3), [release workflow](../.github/workflows/release.yml).

## Linux desktop CI acceptance (pending first successful run)

The Linux packaging job now invokes `scripts/ci-linux-desktop-smoke.sh` on its disposable Ubuntu runner before uploading installers. It checks the DEB package name and executable, extracts the AppImage and checks `AppRun`, installs the DEB using APT, starts the installed GUI under Xvfb for a bounded 20-second observation, and removes the DEB. An immediate launch failure fails the job; a timeout is only a **basic startup signal**, not proof of functional login or fax operations. The script refuses to run without `CI=true` and must never run on a production VPS. This is not a full AppImage launch test, native OS matrix, or secure update test.

The smoke gate is **unverified until GitHub Actions passes on this change**. Review CI logs for runner-specific package dependencies and startup failures rather than bypassing the gate. Do not promote preview packages based solely on this check.

### Observed Linux packaging failure (2026-11-03)

The first PR #15 release workflow (run 41666405079) failed after successful DEB installation: Electron aborted with exit code 133 because the installed `/opt/FaxingPro/chrome-sandbox` helper lacked required root ownership and mode 4755. The smoke script now explicitly checks installed helper metadata before attempting GUI startup and fails with a targeted diagnostic. This is **not a fix to package metadata** and does not constitute passing Linux acceptance. Keep the release gate enforced until packaging is corrected and a fresh CI run passes without `--no-sandbox` or other security bypasses. Do not alter production hosts to investigate this CI-only failure.
