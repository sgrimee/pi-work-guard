# pi-work-guard 🛡️

A **best-effort workspace and model-provider policy guard** for the [Pi Coding Agent](https://pi.dev).

## Goal

Use `pi-work-guard` when the same Pi installation is used for both **work** and **personal** projects. Its purpose is to help you avoid an honest mistake: using an AI provider that your work policy does not permit while you are in a work repository.

It identifies configured workspaces from Git remotes or local paths, compares Pi's active provider with your work policy, and warns or blocks ordinary prompts when that provider is not permitted for the current work context. In personal contexts, the personal policy applies—by default, providers remain available. Configure trusted repository overrides for legitimate edge cases.

> [!IMPORTANT]
> This is a user-assistance tool, **not an unbypassable security or compliance boundary**. Pi extensions run with the user's system permissions; users and other local software can change configuration, disable extensions, or use other tools. Use organization-managed controls where strict enforcement is required.

## Features

- Detects configured work repositories from Git remotes and local path patterns.
- Displays a concise work (`🛡️`), personal (`🏠`), or unknown-workspace (`⚠`) status.
- Blocks ordinary Pi prompts for providers that a configured work policy denies.
- Defaults a workspace to personal when no configured work signal matches and repository evaluation succeeds.
- Blocks provider use when workspace classification is unknown because repository evaluation failed.
- Identifies account hints from the Pi credential currently in use:
  - GitHub Copilot: GitHub.com or GitHub Enterprise profile endpoint
  - OpenAI Codex: non-expired email claim in the active credential
  - Anthropic OAuth: Anthropic Claude CLI bootstrap endpoint
- Includes a generic policy template and JSON Schema.

## Install

Install from npm once the package is published:

```bash
pi install npm:pi-work-guard
```

For local development, point Pi directly at this package directory or its entry point:

```bash
pi install /absolute/path/to/pi-work-guard
# or for a quick source test
pi -e /absolute/path/to/pi-work-guard/src/index.ts
```

Pi loads the TypeScript extension resource directly. Run `/reload` after changing source during an interactive Pi session.

## Configuration

The extension loads one complete policy in this order:

1. `.pi/work-policy.json` in the current repository, **only when Pi trusts that project**
2. `~/.pi/agent/work-policy.json` (or Pi's configured agent directory)
3. Its built-in generic default

A trusted project-local policy intentionally **replaces** the global policy rather than merging with it. This supports repository-specific edge cases; it also means local policies are user-controlled and unsuitable as centralized enforcement.

The first extension load creates the generic global file when one does not exist. Copy and tailor the supplied template first if possible:

```bash
cp examples/generic-policy.json ~/.pi/agent/work-policy.json
```

Every policy must be complete and conform to [`schema.json`](schema.json). `/provider-policy status` reports specific invalid fields (including their config path). An invalid or unreadable trusted project policy falls back to a valid global policy. If no usable global policy remains—for example, the global policy is invalid—the workspace is shown as **Unknown** and all provider use is blocked rather than treating the built-in generic default as a personal-policy decision. After changing policy workspace patterns, use `/provider-policy reload` to immediately clear cached workspace detection.

### Example policy

```json
{
  "company": {
    "name": "Acme Corporation",
    "emailDomains": ["acme.corp"],
    "remotePatterns": [
      "*acme.corp*",
      "github.com/acme-corp/*",
      "gitlab.acme.corp/*"
    ],
    "localPathPatterns": ["~/work/**"]
  },
  "workPolicy": {
    "defaultBehavior": "deny",
    "fallbackModel": "github-copilot/gpt-5.4",
    "providers": {
      "github-copilot": {
        "mode": "require_account",
        "allowedEmailDomains": ["acme.corp"]
      },
      "openai-codex": {
        "mode": "require_account",
        "allowedEmailDomains": ["acme.corp"]
      },
      "anthropic": {
        "mode": "allow_if_tagged",
        "allowedEmailDomains": ["acme.corp"],
        "deniedAccounts": ["*@gmail.com", "*@yahoo.com"]
      },
      "azure-openai": { "mode": "allow" },
      "amazon-bedrock": { "mode": "allow" },
      "opencode": { "mode": "deny" },
      "openrouter": { "mode": "deny" }
    }
  },
  "personalPolicy": {
    "defaultBehavior": "allow"
  }
}
```

`fallbackModel` is displayed as a suggestion after a block. The extension never switches models automatically.

### Workspace states

- **Work:** a configured local path or Git remote matches. The work policy determines whether a provider is permitted.
- **Personal:** no configured work signal matches and the workspace repository can be evaluated. The personal policy determines whether the provider is permitted.
- **Unknown:** the workspace repository cannot be evaluated (for example, Git is unavailable, the directory cannot be read, or the command times out), or the only available policy configuration is invalid or unreadable. Provider use is blocked until the classification can be determined. Use `/provider-policy status` to inspect the reason and resolve the underlying problem.

## Commands

| Command | Description |
| --- | --- |
| `/provider-policy` or `/provider-policy status` | Show workspace classification, policy source, active model, account hint, and warnings. |
| `/provider-policy check <provider> [model]` | Check a provider/model without switching. |
| `/provider-policy reload` | Clear caches and re-read policy configuration. |

## Privacy, prerequisites, and limitations

- Requires Node.js 22.19+ and the Pi Coding Agent. Git is used to inspect remotes.
- To obtain account hints, the extension reads the active Pi credential file. It may call `https://api.github.com/user` for GitHub Copilot and `https://api.anthropic.com/api/claude_cli/bootstrap` for Anthropic OAuth. OpenAI Codex information is read locally from the active credential.
- Identity data is used in memory only; this extension does not persist account attestations or raw credentials.
- A successfully evaluated workspace with no matching local path or Git remote is classified as **personal**. Network failure, missing Git, unreadable directories, and other repository-evaluation errors result in an **unknown** classification that blocks provider use until resolved.
- Account hints and decoded credential claims are not proof of provider entitlements or organizational compliance. Validate provider, tenant, and data-handling requirements through your organization's approved process.

## Development

```bash
npm install
npm test
npm run build
npm pack --dry-run
```

See [SECURITY.md](SECURITY.md) for reporting suspected security issues.

## License

[MIT](LICENSE)
