import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { IdentityInfo } from "./types.js";

type FetchImplementation = typeof globalThis.fetch;

/**
 * Best-effort account identification from the credential currently selected by Pi.
 * It is advisory metadata, not a provider entitlement or a security boundary.
 */
export class IdentityResolver {
  private cache = new Map<string, { credentialFingerprint: string; info: IdentityInfo; expires: number }>();

  constructor(
    private readonly customAuthPath?: string,
    private readonly fetchImpl: FetchImplementation = globalThis.fetch,
  ) {}

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private credentialToken(credential: unknown): string | undefined {
    if (typeof credential !== "object" || credential === null) return undefined;
    const record = credential as Record<string, unknown>;
    for (const value of [record.refresh, record.access, record.key]) {
      if (typeof value === "string" && value.length > 0) return value;
    }
    return undefined;
  }

  private credentialFingerprint(credential: unknown): string {
    const token = this.credentialToken(credential);
    return token ? this.hashToken(token) : "none";
  }

  private cacheIdentity(
    provider: string,
    credentialFingerprint: string,
    info: IdentityInfo,
    ttlMs: number,
  ): IdentityInfo {
    this.cache.set(provider, {
      credentialFingerprint,
      info,
      expires: Date.now() + ttlMs,
    });
    return info;
  }

  /** Returns the public or validated GitHub Enterprise Server profile endpoint. */
  private githubProfileEndpoint(enterpriseUrl: unknown): string | undefined {
    if (enterpriseUrl === undefined || enterpriseUrl === null || enterpriseUrl === "") {
      return "https://api.github.com/user";
    }
    if (typeof enterpriseUrl !== "string") return undefined;

    try {
      const candidate = enterpriseUrl.includes("://") ? enterpriseUrl : `https://${enterpriseUrl}`;
      const enterprise = new URL(candidate);
      if (enterprise.protocol !== "https:" || !enterprise.hostname || enterprise.username || enterprise.password) {
        return undefined;
      }
      const path = enterprise.pathname.replace(/\/+$/, "");
      const apiPath = path.endsWith("/api/v3") ? path : `${path}/api/v3`;
      return new URL(`${apiPath}/user`, enterprise.origin).toString();
    } catch {
      return undefined;
    }
  }

  public readAuthStorage(): Record<string, unknown> {
    const authPath = this.customAuthPath || join(getAgentDir(), "auth.json");
    if (!existsSync(authPath)) return {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(authPath, "utf-8"));
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  private async resolveAnthropicOAuthIdentity(
    accessToken: string,
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

      const payload = (await response.json()) as { oauth_account?: { account_email?: unknown } };
      const email = payload.oauth_account?.account_email;
      if (typeof email !== "string" || !email.includes("@")) return undefined;

      return {
        provider: "anthropic",
        email: email.trim().toLowerCase(),
        verified: true,
        source: "oauth_api",
      };
    } catch {
      return undefined;
    }
  }

  /** Resolve advisory account metadata for a provider credential. */
  public async resolveIdentity(provider: string): Promise<IdentityInfo> {
    const auth = this.readAuthStorage();
    const credential = auth[provider];
    const fingerprint = this.credentialFingerprint(credential);
    const cached = this.cache.get(provider);
    if (cached && cached.credentialFingerprint === fingerprint && Date.now() < cached.expires) {
      return cached.info;
    }

    if (!credential || typeof credential !== "object") {
      return this.cacheIdentity(provider, fingerprint, { provider, verified: false, source: "unknown" }, 10_000);
    }
    const cred = credential as Record<string, unknown>;

    if (provider === "github-copilot") {
      const endpoint = this.githubProfileEndpoint(cred.enterpriseUrl);
      if (typeof cred.refresh === "string" && endpoint) {
        try {
          const response = await this.fetchImpl(endpoint, {
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
                verified: true,
                source: "oauth_api",
              },
              300_000,
            );
          }
        } catch {
          // Account identity remains unknown when the profile endpoint is unavailable.
        }
      }
      return this.cacheIdentity(provider, fingerprint, { provider, verified: false, source: "unknown" }, 60_000);
    }

    if (provider === "openai-codex" && typeof cred.access === "string") {
      try {
        const parts = cred.access.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<string, unknown>;
          if (typeof payload.exp === "number" && payload.exp * 1_000 <= Date.now()) {
            throw new Error("Credential claim is expired");
          }
          const authClaims = payload["https://api.openai.com/auth"];
          const profileClaims = payload["https://api.openai.com/profile"];
          const email = payload.email ||
            (typeof authClaims === "object" && authClaims !== null ? (authClaims as Record<string, unknown>).email : undefined) ||
            (typeof profileClaims === "object" && profileClaims !== null ? (profileClaims as Record<string, unknown>).email : undefined);
          if (typeof email === "string" && email.includes("@")) {
            return this.cacheIdentity(
              provider,
              fingerprint,
              { provider, email: email.toLowerCase(), verified: true, source: "jwt_claim" },
              300_000,
            );
          }
        }
      } catch {
        // Keep unknown rather than accepting a malformed or expired claim.
      }
    }

    if (provider === "anthropic" && cred.type === "oauth" && typeof cred.access === "string") {
      const identity = await this.resolveAnthropicOAuthIdentity(cred.access);
      if (identity) return this.cacheIdentity(provider, fingerprint, identity, 300_000);
    }

    return this.cacheIdentity(provider, fingerprint, { provider, verified: false, source: "unknown" }, 10_000);
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
