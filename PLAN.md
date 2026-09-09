# pi-work-guard implementation notes

`pi-work-guard` is a best-effort Pi extension that helps users notice and avoid accidental provider-policy mismatches. It is not an enforcement boundary.

## Current flow

1. Load a complete policy from a trusted repository override, global Pi agent directory, or built-in defaults.
2. Classify the workspace from configured local-path and Git-remote signals as work or unknown.
3. Resolve best-effort account metadata for selected supported providers.
4. Evaluate the selected provider against the work policy.
5. Display a status indicator and block Pi prompts for denied workspaces or when workspace evaluation fails; treat successfully evaluated non-work workspaces as personal.

## Design decisions

- A Pi-trusted `.pi/work-policy.json` fully replaces the global policy to support repository-specific edge cases.
- Unknown workspaces warn but remain usable under the personal policy; users should resolve the warning with configuration when appropriate.
- Identity metadata is advisory. The extension does not self-attest accounts or infer enterprise entitlement from token strings.
- Invalid policies are ignored with diagnostics rather than passed into policy evaluation.

## Maintenance priorities

- Preserve compatibility with current Pi extension/package conventions.
- Keep the JSON Schema, runtime validator, and documented policy fields aligned.
- Add regression tests whenever workspace classification, identity hints, or policy evaluation changes.
- Run tests, build, and `npm pack --dry-run` before release.
