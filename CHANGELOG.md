# Changelog

All notable changes to this project are documented here.

This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-10-19

### Changed

- Publish the source-based Pi package on GitHub with one-command and pinned-release install examples.
- Run the build and tests before packing.
- Classify successfully evaluated non-work workspaces as personal; block provider use when workspace evaluation fails.

### Fixed

- Route GitHub Enterprise Copilot account lookups to the validated Enterprise profile API instead of public GitHub.
- Eliminate unsafe regular-expression conversion for configured Git remote patterns.
- Scope workspace-detection cache entries to the policy workspace-identification fields.
- Align runtime policy validation with published non-empty schema fields.
- Add a packed-artifact Pi loading smoke test, including when checks run under `npm pack --dry-run`.
- Update locked brace-expansion to 5.0.12 to resolve production dependency denial-of-service advisories.

## [0.1.0] - 2026-09-09

### Added

- Initial best-effort workspace and model-provider policy guard for Pi.
