import { minimatch } from "minimatch";
import type { PolicyConfig, PolicyCheckResult, ProviderRule } from "./types.js";
import type { WorkspaceDetector } from "./detector.js";
import type { IdentityResolver } from "./identity.js";

export class PolicyEngine {
  constructor(
    private detector: WorkspaceDetector,
    private identityResolver: IdentityResolver
  ) {}

  private matchesAccountPattern(email: string, patterns?: string[]): boolean {
    if (!patterns || patterns.length === 0) return false;
    const normalized = email.toLowerCase();
    for (const pattern of patterns) {
      const normalizedPattern = pattern.toLowerCase();
      if (
        normalized === normalizedPattern ||
        minimatch(normalized, normalizedPattern, { nocase: true })
      ) {
        return true;
      }
    }
    return false;
  }

  public async evaluate(
    cwd: string,
    provider: string,
    modelId: string,
    config: PolicyConfig
  ): Promise<PolicyCheckResult> {
    const workspace = await this.detector.isWorkWorkspace(cwd, config);

    // 1. Non-work workspace (Personal repo)
    if (!workspace.isWork) {
      const allowed = config.personalPolicy.defaultBehavior !== "deny";
      return {
        isWorkRepo: false,
        allowed,
        provider,
        modelId,
        reason: allowed
          ? "Personal workspace — all models permitted by personal policy."
          : "Personal workspace policy default is deny.",
      };
    }

    // 2. Corporate work workspace
    const rule: ProviderRule | undefined = config.workPolicy.providers[provider];

    // Unlisted provider
    if (!rule) {
      const allowed = config.workPolicy.defaultBehavior === "allow";
      return {
        isWorkRepo: true,
        allowed,
        provider,
        modelId,
        matchedRemote: workspace.matchedRemote,
        reason: allowed
          ? `Provider '${provider}' allowed by default work policy.`
          : `Provider '${provider}' is not listed in the ${config.company.name} authorized provider policy.`,
      };
    }

    // Explicit Deny
    if (rule.mode === "deny") {
      return {
        isWorkRepo: true,
        allowed: false,
        provider,
        modelId,
        matchedRemote: workspace.matchedRemote,
        reason:
          rule.reason ||
          `Provider '${provider}' is prohibited for use on ${config.company.name} repositories.`,
      };
    }

    // Explicit Allow
    if (rule.mode === "allow") {
      return {
        isWorkRepo: true,
        allowed: true,
        provider,
        modelId,
        matchedRemote: workspace.matchedRemote,
        reason: `Provider '${provider}' is authorized for corporate use.`,
      };
    }

    // Resolve identity
    const identity = await this.identityResolver.resolveIdentity(provider);

    // Require account / corporate verification
    if (rule.mode === "require_account") {
      // Check Enterprise license / SKU
      if (rule.allowEnterpriseSKU && identity.isEnterpriseSKU) {
        return {
          isWorkRepo: true,
          allowed: true,
          provider,
          modelId,
          matchedRemote: workspace.matchedRemote,
          identity,
          reason: `Authenticated via verified enterprise license (${config.company.name}).`,
        };
      }

      if (identity.email) {
        const normalizedEmail = identity.email.toLowerCase();

        // Check explicit denied accounts / patterns
        if (this.matchesAccountPattern(normalizedEmail, rule.deniedAccounts)) {
          return {
            isWorkRepo: true,
            allowed: false,
            provider,
            modelId,
            matchedRemote: workspace.matchedRemote,
            identity,
            reason: `Account '${identity.email}' is explicitly denied on work repositories.`,
          };
        }

        // Check explicit allowed accounts / patterns
        if (this.matchesAccountPattern(normalizedEmail, rule.allowedAccounts)) {
          return {
            isWorkRepo: true,
            allowed: true,
            provider,
            modelId,
            matchedRemote: workspace.matchedRemote,
            identity,
            reason: `Authenticated with authorized work account '${identity.email}'.`,
          };
        }

        // Check corporate email domain
        const emailDomain = normalizedEmail.split("@")[1];
        const allowedDomains = (rule.allowedEmailDomains || config.company.emailDomains).map((d) =>
          d.toLowerCase()
        );

        if (emailDomain && allowedDomains.includes(emailDomain)) {
          return {
            isWorkRepo: true,
            allowed: true,
            provider,
            modelId,
            matchedRemote: workspace.matchedRemote,
            identity,
            reason: `Authenticated with verified @${emailDomain} corporate account (${identity.email}).`,
          };
        }

        return {
          isWorkRepo: true,
          allowed: false,
          provider,
          modelId,
          matchedRemote: workspace.matchedRemote,
          identity,
          reason: `Account '${identity.email}' does not belong to ${config.company.name} (@${config.company.emailDomains.join(", ")}).`,
        };
      }

      return {
        isWorkRepo: true,
        allowed: false,
        provider,
        modelId,
        matchedRemote: workspace.matchedRemote,
        identity,
        reason: `Could not verify corporate identity for '${provider}'. Please log in with your @${config.company.emailDomains.join(", ")} account.`,
      };
    }

    // Allow if tagged / attested
    if (rule.mode === "allow_if_tagged") {
      if (identity.email) {
        const normalizedEmail = identity.email.toLowerCase();

        // Check denied accounts
        if (this.matchesAccountPattern(normalizedEmail, rule.deniedAccounts)) {
          return {
            isWorkRepo: true,
            allowed: false,
            provider,
            modelId,
            matchedRemote: workspace.matchedRemote,
            identity,
            reason: `Account '${identity.email}' is prohibited for corporate use.`,
          };
        }

        // Check specific allowed accounts / wildcards
        if (this.matchesAccountPattern(normalizedEmail, rule.allowedAccounts)) {
          return {
            isWorkRepo: true,
            allowed: true,
            provider,
            modelId,
            matchedRemote: workspace.matchedRemote,
            identity,
            reason: `The '${provider}' model provider is authenticated with approved corporate account '${identity.email}'.`,
          };
        }

        // Check allowed corporate domain (e.g. any @company.com)
        const emailDomain = normalizedEmail.split("@")[1];
        const allowedDomains = (rule.allowedEmailDomains || config.company.emailDomains).map((d) =>
          d.toLowerCase()
        );

        if (emailDomain && allowedDomains.includes(emailDomain)) {
          return {
            isWorkRepo: true,
            allowed: true,
            provider,
            modelId,
            matchedRemote: workspace.matchedRemote,
            identity,
            reason: `The '${provider}' model provider is authenticated with a verified @${emailDomain} corporate account (${identity.email}).`,
          };
        }
      }

      const domainDesc = (rule.allowedEmailDomains || config.company.emailDomains).map((d) => `@${d}`).join(", ");
      return {
        isWorkRepo: true,
        allowed: false,
        provider,
        modelId,
        matchedRemote: workspace.matchedRemote,
        identity,
        reason: `Provider '${provider}' requires an attested corporate account (${domainDesc}). Run '/provider-policy account ${provider} <email>' to attest.`,
      };
    }

    return {
      isWorkRepo: true,
      allowed: false,
      provider,
      modelId,
      matchedRemote: workspace.matchedRemote,
      reason: `Unknown policy mode for provider '${provider}'.`,
    };
  }
}
