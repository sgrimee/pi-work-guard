# `pi-work-guard` Architecture & Implementation Plan

## 1. Executive Summary

`pi-work-guard` is a security and compliance extension for the Pi coding agent. It automatically enforces enterprise model provider policies when working inside corporate repositories.

Key capabilities:
- **Automatic Workspace Classification:** Detects corporate repositories via Git remote URLs (e.g. `*.company.com`, `github.com/org/*`, SSH remotes) and optional filesystem path globs.
- **Deterministic Identity Verification:** Probes active credentials from `~/.pi/agent/auth.json`:
  - **GitHub Copilot:** Probes GitHub User API with OAuth token to verify corporate email (`*@company.com`) and validates enterprise seat SKUs.
  - **OpenAI Codex:** Decodes OAuth JWT claims (`email`, `chatgpt_account_id`) to verify corporate identity.
  - **Anthropic / Claude:** Queries Anthropic's authenticated Claude CLI bootstrap endpoint after standard Pi login to resolve the current account email. Credential-fingerprinted caching detects OAuth refreshes and account switches; token-bound manual attestation is an offline fallback.
  - **OpenCode / OpenRouter / Custom:** Strictly blocks prohibited external providers on corporate code.
- **Multi-Layer Defense in Depth:** Enforces policies at the UI layer (`session_start`, `model_select`), the turn entrypoint (`input` hook returning `{ action: "handled" }`), and the network firewall pre-flight hook (`before_provider_request` abort).

---

## 2. Component Architecture

```
                               ┌─────────────────────────────┐
                               │       Pi Coding Agent       │
                               └──────────────┬──────────────┘
                                              │
              ┌───────────────────────────────┼───────────────────────────────┐
              │                               │                               │
              ▼                               ▼                               ▼
      [session_start]                   [input hook]             [before_provider_request]
      Update Status Bar                 Intercept Prompt         Hard Network Safety Net
              │                               │                               │
              └───────────────────────┬───────┴───────────────────────────────┘
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │   PolicyEngine.evaluate   │
                        └─────────────┬─────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 │                                         │
                 ▼                                         ▼
     ┌───────────────────────┐                 ┌───────────────────────┐
     │   WorkspaceDetector   │                 │   IdentityResolver    │
     │ - Git remote URLs     │                 │ - Copilot User Probe  │
     │ - Path patterns       │                 │ - OpenAI JWT Claims   │
     │ - TTL Cache           │                 │ - Anthropic Lineage   │
     └───────────────────────┘                 └───────────────────────┘
```

---

## 3. Enforcement Lifecycle & Hook Mapping

### 1. `session_start`
- Runs when a session opens or is resumed/forked.
- Resolves workspace classification and active model compliance.
- Updates the interactive TUI footer status:
  - `🛡️` for a compliant work workspace
  - `🚨 Company Name Policy Block: model provider 'opencode' not approved`
  - `🏠` for a personal workspace

### 2. `model_select`
- Triggered when the user switches models (`/model` or `Ctrl+P`).
- If an unauthorized model/provider is chosen in a corporate repo, shows an immediate notification alert:
  `⚠️ Work Policy Alert: The 'opencode' model provider (gemini-3.7-flash) is not approved for this corporate repository.`

### 3. `input`
- Intercepts normal user prompt submission before prompt templates or subagents run.
- If non-compliant on a corporate repo:
  - Notifies user with full reason and suggested compliant models.
  - Returns `{ action: "handled" }` to abort turn processing entirely without hitting LLM.

### 4. `before_provider_request`
- Pre-flight network hook executed after the provider payload is built but before transport.
- Hard firewall: aborts the active agent signal if any unauthorized request attempts outbound transit. Pi intentionally reports and swallows extension-hook exceptions, so throwing from this hook is not an enforcement mechanism.

---

## 4. Identity & Token Resolution Mechanics

### GitHub Copilot
- Inspects `~/.pi/agent/auth.json` entry `github-copilot`.
- Uses `refresh` token (`ghu_...`) with `https://api.github.com/user` to obtain verified user email and login.
- Inspects `access` token for `sku=copilot_enterprise_seat_quota` and `proxy-ep=proxy.enterprise.githubcopilot.com`.

### OpenAI Codex (ChatGPT Plus / Pro)
- Inspects `~/.pi/agent/auth.json` entry `openai-codex`.
- Decodes JWT access token payload without network calls.
- Reads `payload.email` or `payload["https://api.openai.com/auth"].email`.

### Anthropic OAuth Account Resolution
- After Pi's standard `/login anthropic` flow, the plugin calls Anthropic's authenticated `/api/claude_cli/bootstrap` endpoint with the active OAuth access token.
- The returned `oauth_account.account_email` is evaluated against configured corporate domains and account patterns.
- Identity cache entries include a credential fingerprint, so OAuth refreshes and account switches trigger a fresh account lookup instead of reusing stale identity data.
- If the profile endpoint is temporarily unavailable, a manual token-bound attestation created with `/provider-policy account anthropic user@company.com` can be used for the unchanged credential only.
- A changed credential is never automatically promoted to an existing attestation.

---

## 5. Configuration Schema

Configuration is loaded hierarchically:
1. Workspace-level `.pi/work-policy.json` (if present)
2. Global `~/.pi/agent/work-policy.json`
3. Built-in defaults

See `examples/` for ready-to-use policy templates.

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
        "deniedAccounts": ["*@gmail.com"]
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

## 6. Interactive Slash Commands

- `/provider-policy`: Display full compliance status, active workspace, current model, and identity.
- `/provider-policy check <provider> [model]`: Test a provider without switching to it.
- `/provider-policy account <provider> <email>`: Attest active token for Anthropic or tagged accounts.
- `/provider-policy reload`: Reload policy configuration and clear cached metadata.
