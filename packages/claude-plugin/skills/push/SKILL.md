---
name: push
description: Push local changes directly to configured branch on GitHub
---

# Push to GitHub

Push local changes directly to the configured branch on GitHub.

## Steps

### 1. Find Config

Look for config at `$HOME/.any-sync.json` first, then `.any-sync.json` in the current directory. If neither exists, tell the user to run `/any-sync:start` first.

### 2. Check for Changes

Run the status command to see what has changed:
```bash
npx @any-sync/cli status "<config-path>" ".any-sync.lock"
```

Show the user which files have changed (modified or new) across all mappings.

### 3. Detect Untracked Files

Check the `untracked` array in the status output for each mapping. These are files that exist locally in the sync directory but don't match the current include patterns.

If there are untracked files:
1. List them to the user, grouped by mapping name. For example:
   ```
   Untracked files detected (not matching current sync rules):
     [claude-skills]
       - my-new-skill.yaml
       - tools/helper.py
     [claude-memory]
       - notes.txt
   ```
2. Ask the user which files they want to add to the sync. They can choose:
   - **All** — sync all untracked files
   - **Some** — pick specific files or patterns
   - **None** — skip, push only files matching existing rules
3. For each selected file, determine the include pattern:
   - If the user selects specific files, use their exact filenames (e.g., `notes.txt`)
   - If files share a common extension, suggest a glob pattern (e.g., `**/*.yaml`) and let the user choose between the glob or individual filenames
4. Run the update-config command to add the new include patterns:
   ```bash
   npx @any-sync/cli update-config "<config-path>" "<mapping-name>" --add-include "<pattern>" [--add-include "<pattern>" ...]
   ```
5. Re-run the status command to pick up the newly-included files before proceeding to confirmation.

If there are no untracked files, skip to the next step.

### 4. Confirm Push

Ask the user to confirm before pushing. Show:
- Which files will be pushed
- Which branch they will be pushed to
- Which repo they will be pushed to

### 5. Run Push

If confirmed:
```bash
npx @any-sync/cli push "<config-path>" ".any-sync.lock"
```

### 6. Report Results

Parse the JSON output and report:
- Files pushed
- Branch updated
- Any errors encountered
