# Changelog

All notable changes to this project are documented here.

This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Prepared the package for Pi package discovery and controlled npm publication.
- Classify successfully evaluated non-work workspaces as personal; block provider use when workspace evaluation fails.

### Fixed

- Route GitHub Enterprise Copilot account lookups to the validated Enterprise profile API instead of public GitHub.
- Eliminate unsafe regular-expression conversion for configured Git remote patterns.
- Scope workspace-detection cache entries to the policy workspace-identification fields.
- Align runtime policy validation with published non-empty schema fields.
- Add a packed-artifact Pi loading smoke test.

## [0.1.0] - 2026-09-09

### Added

- Initial best-effort workspace and model-provider policy guard for Pi.
