import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { IdentityInfo, AccountStore } from "./types.js";

type FetchImplementation = typeof globalThis.fetch;

export class IdentityResolver {
  private cache = new Map<
    string,
    { credentialFingerprint: string; info: IdentityInfo; expires: number }
  >();
  private readonly customAuthPath?: string;
  private readonly accountsStorePath: string;
  private readonly fetchImpl: FetchImplementation;

  constructor(
    customAuthPath?: string,
    customAccountsStorePath?: string,
    fetchImpl: FetchImplementation = globalThis.fetch
  ) {
    this.customAuthPath = customAuthPath;
    this.accountsStorePath =
      customAccountsStorePath || join(homedir(), ".pi", "agent", "work-policy-accounts.json");
    this.fetchImpl = fetchImpl;
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private credentialToken(credential: any): string | undefined {
    for (const value of [credential?.refresh, credential?.access, credential?.key]) {
      if (typeof value === "string" && value.length > 0) return value;
    }
    return undefined;
  }

  private credentialFingerprint(credential: any): string {
    const token = this.credentialToken(credential);
    return token ? this.hashToken(token) : "none";
  }

  private cacheIdentity(
    provider: string,
    credentialFingerprint: string,
    info: IdentityInfo,
    ttlMs: number
  ): IdentityInfo {
    this.cache.set(provider, {
      credentialFingerprint,
      info,
      expires: Date.now() + ttlMs,
    });
    return info;
  }

  public readAuthStorage(): Record<string, any> {
    const authPath = this.customAuthPath || join(homedir(), ".pi", "agent", "auth.json");
    if (!existsSync(authPath)) return {};
    try {
      return JSON.parse(readFileSync(authPath, "utf-8"));
    } catch {
      return {};
    }
  }

  public readAccountStore(): AccountStore {
    if (!existsSync(this.accountsStorePath)) {
      return { accounts: {} };
    }
    try {
      return JSON.parse(readFileSync(this.accountsStorePath, "utf-8"));
    } catch {
      return { accounts: {} };
    }
  }

  public writeAccountStore(store: AccountStore): void {
    try {
      mkdirSync(dirname(this.accountsStorePath), { recursive: true });
      writeFileSync(this.accountsStorePath, JSON.stringify(store, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
    } catch {
      // Ignore write errors if permissions or dir inaccessible
    }
  }

  private saveVerifiedAccount(provider: string, email: string, tokenHash: string): void {
    const store = this.readAccountStore();
    const now = Date.now();
    store.accounts[provider] = {
      account: email.trim().toLowerCase(),
      tokenHash,
      attestedAt: now,
      lastSeenAt: now,
    };
    this.writeAccountStore(store);
  }

  /**
   * Manually attests an account binding for an opaque provider credential.
   * Prefer automatic provider identity probes when available.
   */
  public attestAccount(provider: string, email: string): boolean {
    const auth = this.readAuthStorage();
    const token = this.credentialToken(auth[provider]);
    if (!token) return false;

    this.saveVerifiedAccount(provider, email, this.hashToken(token));
    this.cache.delete(provider);
    return true;
  }

  /**
   * Resolve the Anthropic OAuth account through the same authenticated bootstrap
   * endpoint used by Claude Code. This works after Pi's standard /login anthropic
   * flow even though Pi's auth.json intentionally stores only OAuth tokens.
   */
  private async resolveAnthropicOAuthIdentity(
    accessToken: string,
    credentialFingerprint: string
  ): Promise<IdentityInfo | undefined> {
    try {
      const response = await this.fetchImpl("https://api.anthropic.com/api/claude_cli/bootstrap", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          "anthropic-version": "2023-06-01",
          "User-Agent": "pi-work-guard",
        },
        signal: AbortSignal.timeout(4_000),
      });

      if (!response.ok) return undefined;

      const payload = (await response.json()) as {
        oauth_account?: {
          account_email?: unknown;
        };
      };
      const email = payload.oauth_account?.account_email;
      if (typeof email !== "string" || !email.includes("@")) return undefined;

      const normalizedEmail = email.trim().toLowerCase();
      this.saveVerifiedAccount("anthropic", normalizedEmail, credentialFingerprint);
      return {
        provider: "anthropic",
        email: normalizedEmail,
        verified: true,
        source: "oauth_api",
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Resolves the identity for a given provider.
   */
  public async resolveIdentity(provider: string): Promise<IdentityInfo> {
    const auth = this.readAuthStorage();
    const cred = auth[provider];
    const fingerprint = this.credentialFingerprint(cred);
    const cached = this.cache.get(provider);
    if (
      cached &&
      cached.credentialFingerprint === fingerprint &&
      Date.now() < cached.expires
    ) {
      return cached.info;
    }

    if (!cred) {
      return this.cacheIdentity(
        provider,
        fingerprint,
        { provider, verified: false, source: "unknown" },
        10_000
      );
    }

    // 1. GitHub Copilot: Probe OAuth user API & token inspection
    if (provider === "github-copilot") {
      const isEnterprise =
        typeof cred.access === "string" &&
        (cred.access.includes("copilot_enterprise") ||
          cred.access.includes("proxy.enterprise") ||
          cred.access.includes("enterprise.githubcopilot.com") ||
          !!cred.enterpriseUrl);

      // Probe GitHub User API using OAuth refresh token (ghu_...)
      if (cred.refresh && typeof cred.refresh === "string") {
        try {
          const response = await this.fetchImpl("https://api.github.com/user", {
            headers: {
              Authorization: `Bearer ${cred.refresh}`,
              Accept: "application/json",
              "User-Agent": "pi-work-guard",
            },
            signal: AbortSignal.timeout(3_000),
          });

          if (response.ok) {
            const data = (await response.json()) as { email?: string; login?: string };
            return this.cacheIdentity(
              provider,
              fingerprint,
              {
                provider,
                email: data.email?.toLowerCase(),
                username: data.login,
                isEnterpriseSKU: isEnterprise,
                verified: true,
                source: "oauth_api",
              },
              300_000
            );
          }
        } catch {
          // Fallback to token claims if network unavailable
        }
      }

      return this.cacheIdentity(
        provider,
        fingerprint,
        {
          provider,
          isEnterpriseSKU: isEnterprise,
          verified: isEnterprise,
          source: isEnterprise ? "jwt_claim" : "unknown",
        },
        60_000
      );
    }

    // 2. OpenAI Codex: Inspect JWT claims
    if (provider === "openai-codex" && typeof cred.access === "string") {
      try {
        const parts = cred.access.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
          const email =
            payload.email ||
            payload["https://api.openai.com/auth"]?.email ||
            payload["https://api.openai.com/profile"]?.email;

          return this.cacheIdentity(
            provider,
            fingerprint,
            {
              provider,
              email: email ? String(email).toLowerCase() : undefined,
              verified: !!email,
              source: "jwt_claim",
            },
            300_000
          );
        }
      } catch {
        // Fall through to token-bound attestation.
      }
    }

    // 3. Anthropic OAuth: automatically resolve the account selected in standard Pi login.
    if (
      provider === "anthropic" &&
      cred.type === "oauth" &&
      typeof cred.access === "string"
    ) {
      const identity = await this.resolveAnthropicOAuthIdentity(cred.access, fingerprint);
      if (identity) {
        return this.cacheIdentity(provider, fingerprint, identity, 300_000);
      }
    }

    // 4. Token-bound manual attestation fallback for opaque/offline credentials.
    const activeToken = this.credentialToken(cred);
    if (activeToken) {
      const store = this.readAccountStore();
      const entry = store.accounts[provider];
      if (entry?.tokenHash === fingerprint) {
        entry.lastSeenAt = Date.now();
        this.writeAccountStore(store);
        return this.cacheIdentity(
          provider,
          fingerprint,
          {
            provider,
            email: entry.account,
            verified: true,
            source: "token_attestation",
          },
          60_000
        );
      }
    }

    return this.cacheIdentity(
      provider,
      fingerprint,
      { provider, verified: false, source: "unknown" },
      10_000
    );
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
