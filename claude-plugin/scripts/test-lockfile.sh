#!/bin/bash
# Quick smoke test for lockfile utilities
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/any-sync-lockfile.sh"

TMPLOCK=$(mktemp /tmp/test-lockfile.XXXXXX)
trap 'rm -f "$TMPLOCK"' EXIT

# Test init with empty file
lockfile_init "$TMPLOCK"
echo "PASS: init empty"

# Test set entry
lockfile_set_entry "skills::readme.md" "abc123" "def456hash"
echo "PASS: set entry"

# Test get entry
ENTRY=$(lockfile_get_entry "skills::readme.md")
REMOTE=$(echo "$ENTRY" | jq -r '.remoteSha')
if [ "$REMOTE" = "abc123" ]; then
  echo "PASS: get entry remoteSha"
else
  echo "FAIL: expected abc123, got $REMOTE" >&2
  exit 1
fi

# Test save and reload
lockfile_save
lockfile_init "$TMPLOCK"
ENTRY2=$(lockfile_get_entry "skills::readme.md")
REMOTE2=$(echo "$ENTRY2" | jq -r '.remoteSha')
if [ "$REMOTE2" = "abc123" ]; then
  echo "PASS: save and reload"
else
  echo "FAIL: lost data after save/reload" >&2
  exit 1
fi

# Test last sync
lockfile_set_last_sync "skills"
LS=$(lockfile_get_last_sync "skills")
if [ "$LS" != "null" ]; then
  echo "PASS: last sync"
else
  echo "FAIL: last sync was null" >&2
  exit 1
fi

# Test hash_file
echo -n "hello" > "${TMPLOCK}.hashtest"
HASH=$(hash_file "${TMPLOCK}.hashtest")
rm -f "${TMPLOCK}.hashtest"
# SHA-256 of "hello" = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
if [ "$HASH" = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" ]; then
  echo "PASS: hash_file"
else
  echo "FAIL: hash mismatch: $HASH" >&2
  exit 1
fi

# Test make_key
KEY=$(lockfile_make_key "mymap" "path/to/file.md")
if [ "$KEY" = "mymap::path/to/file.md" ]; then
  echo "PASS: make_key"
else
  echo "FAIL: key=$KEY" >&2
  exit 1
fi

# Test get_entries_for_mapping
lockfile_set_entry "skills::file1.md" "sha1" "hash1"
lockfile_set_entry "skills::dir/file2.md" "sha2" "hash2"
lockfile_set_entry "memory::note.md" "sha3" "hash3"
ENTRIES=$(lockfile_get_entries_for_mapping "skills")
COUNT=$(echo "$ENTRIES" | jq 'length')
if [ "$COUNT" -ge 2 ]; then
  echo "PASS: get_entries_for_mapping"
else
  echo "FAIL: expected >= 2 entries, got $COUNT" >&2
  exit 1
fi

echo ""
echo "All lockfile tests passed."
