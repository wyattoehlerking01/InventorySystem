#!/usr/bin/env bash
set -euo pipefail

# Scans tracked files for common secret patterns.
# Intended as a quick pre-commit safety check.

tmpfile="$(mktemp)"
trap 'rm -f "$tmpfile"' EXIT

# Build a newline-separated list of tracked files, excluding known-safe templates/docs.
git ls-files \
  ':!:*.md' \
  ':!:.env.example' \
  ':!:**/.env.example' \
  ':!:pi/inventory-door-telemetry.env.example' \
  ':!:kiosk/env.js' \
  ':!:manage/env.js' > "$tmpfile"

if [[ ! -s "$tmpfile" ]]; then
  echo "No tracked files to scan."
  exit 0
fi

pattern='SUPABASE_PI_RPC_KEY\s*=\s*[^[:space:]]+|SUPABASE_SERVICE_ROLE_KEY\s*=\s*[^[:space:]]+|eyJ[[:alnum:]_-]{20,}\.[[:alnum:]_-]{20,}\.[[:alnum:]_-]{10,}|AKIA[0-9A-Z]{16}|ghp_[[:alnum:]]{36}|github_pat_[[:alnum:]_]{20,}'

matches=""
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  if [[ ! -f "$file" ]]; then
    continue
  fi
  set +e
  out="$(grep -EnHI "$pattern" "$file")"
  status=$?
  set -e
  if [[ $status -eq 0 ]]; then
    if [[ -n "$matches" ]]; then
      matches+=$'\n'
    fi
    matches+="$out"
  elif [[ $status -ne 1 ]]; then
    echo "Secret scan failed to run cleanly." >&2
    exit $status
  fi
done < "$tmpfile"

if [[ -z "$matches" ]]; then
  echo "No obvious secrets detected."
  exit 0
fi

# Filter the known placeholder entry in example template style lines.
filtered="$(printf '%s\n' "$matches" | grep -Ev 'RESTRICTED_RPC_EXECUTE_KEY' || true)"

# Ignore variable references that are not hardcoded secrets.
filtered="$(printf '%s\n' "$filtered" | grep -Ev 'os\.getenv\("SUPABASE_PI_RPC_KEY"' || true)"

if [[ -z "$filtered" ]]; then
  echo "No obvious secrets detected."
  exit 0
fi

echo "Potential secrets detected:\n"
echo "$filtered"
echo "\nCommit blocked: remove/rotate secrets before committing."
exit 1
