# Changelog

## [0.1.0] - 2024-01-01

### Added
- Initial release
- Pull files from GitHub repos via REST API (Trees + Blobs)
- Push local changes via sparse git checkout with PR creation
- REST API push fallback when git is unavailable
- `.any-sync.json` configuration with JSON schema validation
- Incremental sync via `.any-sync.lock` lockfile
- Conflict resolution with side-by-side diff view
- Status bar sync state indicator
- Include/exclude glob pattern filtering
- VSCode GitHub authentication with GITHUB_TOKEN fallback
- Network retry with exponential backoff
