# FaxingPro — guarded update of an existing production VPS

This procedure is for an **existing FaxingPro checkout** with scheduled encrypted local backups, verified Google Drive copies, PostgreSQL and the two named persistent Docker volumes. It does **not** install a new VPS, alter the reverse proxy, create accounts, set Telnyx keys, enable fax sending, or reset the database.

For the existing `mttech-vps` checkout, the safest path is to perform a read-only operational preflight first, then an explicit API/web deployment during a quiet maintenance window. Actual VPS execution still requires access to that server; merging code or downloading a release does **not** deploy the backend automatically.

## 1. Establish local and offsite recovery readiness

From a trusted root console, ensure you can sign in as the owner, that the recovery identity is safely stored off the VPS, and that the latest backup can be read from Google Drive. Before a major update, test an actual offsite restore on a **different staging machine** using [STAGING_RECOVERY_REHEARSAL.md](STAGING_RECOVERY_REHEARSAL.md). The health monitor validates archive checksums, but is not a substitute for a real restore.

Update the **Git checkout only**, which does not restart containers:

```bash
cd /root/FaxingPro
git status --short
git pull --ff-only
```

Stop and reconcile unexpected tracked changes rather than doing a hard reset. Do not display or share `deployment/telnyx/.env`.

## 2. Fail-closed preflight

```bash
cd /root/FaxingPro
sudo bash scripts/faxingpro-deploy-guard.sh --check
```

The guard verifies:

- Clean `main` checkout and fast-forward compatibility with GitHub.
- A valid existing Compose configuration, an already-working local API, and both named persistent database/document volumes.
- Successful local encrypted archive integrity and Google Drive health check (using the existing root-owned independent monitor).
- Read-only PostgreSQL query: no **recent (20-minute) unfinished outbound submissions**, with a failed/missing database query blocking the update rather than guessing.
- At least 2 GB of free space on the Docker filesystem.

The preflight may refresh Git remote metadata but **does not** rebuild images, restart containers, change live databases, delete documents, upload or delete backups, send a fax or mutate security settings. Missing backups, unknown database status, active submissions and Git divergence block the deployment.

## 3. Explicit maintenance-window deployment

When the preflight passes and you have ensured no fax is actively processing:

```bash
cd /root/FaxingPro
sudo bash scripts/faxingpro-deploy-guard.sh --apply
```

Type `DEPLOY` when prompted. The existing `scripts/install-vps.sh --update --dir /root/FaxingPro` now delegates to the same guard. `--yes` is available for **operator-approved** noninteractive deployments but is not the default and should not be used on a shared unattended VPS.

The script fast-forwards to GitHub `main`, builds API and web images before cutover, recreates **only** those two services, checks local `/healthz` and unauthenticated `/api/session` and rechecks archive/Drive health. PostgreSQL and encrypted document volumes remain present and unchanged by the script. The API startup may apply **additive schema migrations** that cannot necessarily be reverted merely by switching Git commits. A brief API/web interruption is possible.

No automatic rollback or hard reset is attempted. If a post-deploy check fails, stop, review Compose logs, and use a controlled recovery plan with your offsite backups. Do **not** use `docker compose down -v`.

## 4. Validate externally and retain evidence

```bash
cd /root/FaxingPro
git rev-parse --short HEAD
docker compose -f deployment/telnyx/compose.yaml --env-file deployment/telnyx/.env ps
curl -fsS https://fax.mttechservicesllc.com/healthz
sudo bash scripts/faxingpro-backup-health.sh --check
```

In a private browser at the **live** HTTPS FaxingPro URL, check owner login, Team Members, Security & Sessions events, Inbox and a stored PDF. Do not use a real outbound fax as a smoke test unless its destination has been explicitly approved.

Record the deployed commit, preflight outcome, public health result, backup health, operator login result, and any follow-up **without passwords, tokens, fax numbers or customer documents**.

The new guard does not prove production deployment until the user runs it and independently verifies the live HTTPS service. If your VPS is installed elsewhere, pass `--dir /absolute/checkout` to the guard. New installations use the guided `install-vps.sh`, not this updater.
