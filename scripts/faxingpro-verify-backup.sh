#!/usr/bin/env bash
# Run on an independent, trusted machine with your age PRIVATE identity.
set -Eeuo pipefail
if [[ $# -ne 2 ]]; then
  echo "Usage: $0 BACKUP_DIRECTORY AGE_IDENTITY_FILE" >&2; exit 2
fi
directory="$(realpath "$1")"; identity="$2"
[[ -f "$directory/SHA256SUMS" && -f "$identity" ]] || { echo "Missing backup manifest or identity" >&2; exit 2; }
for command_name in age sha256sum tar pg_restore awk; do
  command -v "$command_name" >/dev/null || { echo "Missing command: $command_name" >&2; exit 2; }
done
(cd "$directory" && sha256sum -c SHA256SUMS)
age -d -i "$identity" "$directory/database.dump.age" | pg_restore --list >/dev/null
age -d -i "$identity" "$directory/documents.tar.age" | tar -tf - >/dev/null
age -d -i "$identity" "$directory/config.env.age" |
  awk '/^STORAGE_ENCRYPTION_KEY=/{found=1} END{exit !found}'
echo "Encrypted archive checksums and structure verified. Perform a staging restore to validate recovery."
