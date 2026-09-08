# `pi-work-guard` 🛡️

Enterprise Model Provider Policy Guard for the [Pi Coding Agent](https://github.com/earendil-works/pi-mono).

`pi-work-guard` prevents accidental transmission of proprietary enterprise code to unauthorized LLM model providers by automatically detecting corporate repositories, validating authenticated accounts, and intercepting unauthorized prompts.

---

## Features

- **🏢 Automatic Work Repo Detection:** Inspects Git remotes (e.g. `*.company.com`, `github.com/org/*`, SSH remotes `git@github.company.com:...`) and local paths to differentiate between work and personal workspaces.
- **👤 Dynamic Account Verification:**
  - **GitHub Copilot:** Probes authenticated GitHub user profile via OAuth to verify corporate email and enterprise seat SKU.
  - **OpenAI Codex:** Decodes OAuth JWT claims to verify corporate email.
  - **Anthropic (Claude Pro/Max):** Queries Anthropic's authenticated Claude CLI bootstrap endpoint to identify the account selected by Pi's standard `/login anthropic` flow. OAuth refreshes and account switches are detected automatically; manual token-bound attestation remains available as an offline fallback.
  - **OpenCode / OpenRouter:** Strictly blocked on corporate repositories.
- **⚡ Zero-Bypass Multi-Layer Enforcement:**
  - **UI / Status Bar:** Shows a compact workspace indicator (`🛡️` for compliant work, `🏠` for personal) while retaining a verbose `🚨 Policy Block` warning when non-compliant.
  - **Prompt Interception (`input` hook):** Prevents prompt turn execution if unauthorized.
  - **Network Safety Net (`before_provider_request` hook):** Aborts the active agent signal after payload construction and before provider transport.
- **🌍 Enterprise Configurable:** Fully customizable for any organization via `work-policy.json`. See ready-to-use templates in `examples/`.

---

## Installation & Setup

### Point Pi at the repository source (recommended for development)

Install dependencies:

```bash
npm install
```

Then add the absolute source entry path to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "/absolute/path/to/pi-work-guard/src/index.ts"
  ]
}
```

Pi loads TypeScript extensions directly, so no build or symlink is required. Run `/reload` after source changes. Use `npm run build` before publishing a release.

---

## Configuration (`work-policy.json`)

`pi-work-guard` looks for configuration in:
1. `.pi/work-policy.json` (Project-local override)
2. `~/.pi/agent/work-policy.json` (Global configuration)
3. Built-in default configuration

To configure for your organization, copy and customize a policy template from `examples/`:

```bash
cp examples/generic-policy.json ~/.pi/agent/work-policy.json
```

### Configuration Structure:

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
        "allowedEmailDomains": ["acme.corp"],
        "allowEnterpriseSKU": true
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
      "opencode": { "mode": "deny", "reason": "The 'OpenCode Zen' provider is not approved for corporate repositories." },
      "openrouter": { "mode": "deny", "reason": "OpenRouter is prohibited on corporate code." }
    }
  },
  "personalPolicy": {
    "defaultBehavior": "allow"
  }
}
```

---

## Slash Commands

| Command | Description |
| :--- | :--- |
| `/provider-policy` or `/provider-policy status` | Displays current workspace classification, active model, and policy compliance status. |
| `/provider-policy check <provider> [model]` | Tests whether a specific provider or model is permitted in the current workspace. |
| `/provider-policy account <provider> <email>` | Attests the active credential for a provider (e.g. `/provider-policy account anthropic user@company.com`). |
| `/provider-policy reload` | Reloads `work-policy.json` and flushes cached identity metadata. |

---

## Running Tests

The test suite uses Node's native test runner:

```bash
npm test
```

---

## License

MIT
