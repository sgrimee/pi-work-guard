import { minimatch } from "minimatch";
import type { PolicyConfig, PolicyCheckResult, ProviderRule } from "./types.js";
import type { WorkspaceDetector } from "./detector.js";
import type { IdentityResolver } from "./identity.js";

export class PolicyEngine {
  constructor(
    private detector: WorkspaceDetector,
    private identityResolver: IdentityResolver,
  ) {}

  private matchesAccountPattern(email: string, patterns?: string[]): boolean {
    if (!patterns || patterns.length === 0) return false;
    const normalized = email.toLowerCase();
    return patterns.some((pattern) => {
      const normalizedPattern = pattern.toLowerCase();
      return normalized === normalizedPattern || minimatch(normalized, normalizedPattern, { nocase: true });
    });
  }

  public async evaluate(
    cwd: string,
    provider: string,
    modelId: string,
    config: PolicyConfig,
  ): Promise<PolicyCheckResult> {
    const workspace = await this.detector.isWorkWorkspace(cwd, config);

    if (!workspace.isWork) {
      const classification = workspace.classification;
      const allowed = classification === "unknown"
        ? false
        : config.personalPolicy.defaultBehavior !== "deny";
      return {
        isWorkRepo: false,
        workspaceClassification: classification,
        workspaceWarning: workspace.warning,
        allowed,
        provider,
        modelId,
        reason: classification === "unknown"
          ? "Workspace could not be evaluated; provider use is blocked until its classification can be determined."
          : allowed
            ? "Personal workspace — all models permitted by personal policy."
            : "Personal workspace policy default is deny.",
      };
    }

    const base = {
      isWorkRepo: true,
      workspaceClassification: "work" as const,
      provider,
      modelId,
      matchedRemote: workspace.matchedRemote,
    };
    const rule: ProviderRule | undefined = config.workPolicy.providers[provider];

    if (!rule) {
      const allowed = config.workPolicy.defaultBehavior === "allow";
      return {
        ...base,
        allowed,
        reason: allowed
          ? `Provider '${provider}' allowed by default work policy.`
          : `Provider '${provider}' is not listed in the ${config.company.name} authorized provider policy.`,
      };
    }

    if (rule.mode === "deny") {
      return {
        ...base,
        allowed: false,
        reason: rule.reason || `Provider '${provider}' is prohibited for use on ${config.company.name} repositories.`,
      };
    }

    if (rule.mode === "allow") {
      return {
        ...base,
        allowed: true,
        reason: `Provider '${provider}' is authorized for corporate use.`,
      };
    }

    const identity = await this.identityResolver.resolveIdentity(provider);

    if (rule.mode === "require_account") {
      if (identity.email) {
        const normalizedEmail = identity.email.toLowerCase();
        if (this.matchesAccountPattern(normalizedEmail, rule.deniedAccounts)) {
          return {
            ...base,
            allowed: false,
            identity,
            reason: `Account '${identity.email}' is explicitly denied on work repositories.`,
          };
        }

        if (this.matchesAccountPattern(normalizedEmail, rule.allowedAccounts)) {
          return {
            ...base,
            allowed: true,
            identity,
            reason: `Authenticated with authorized work account '${identity.email}'.`,
          };
        }

        const emailDomain = normalizedEmail.split("@")[1];
        const allowedDomains = (rule.allowedEmailDomains || config.company.emailDomains).map((domain) =>
          domain.toLowerCase(),
        );
        if (emailDomain && allowedDomains.includes(emailDomain)) {
          return {
            ...base,
            allowed: true,
            identity,
            reason: `Authenticated with verified @${emailDomain} corporate account (${identity.email}).`,
          };
        }

        return {
          ...base,
          allowed: false,
          identity,
          reason: `Account '${identity.email}' does not belong to ${config.company.name} (@${config.company.emailDomains.join(", ")}).`,
        };
      }

      return {
        ...base,
        allowed: false,
        identity,
        reason: `Could not verify corporate identity for '${provider}'. Please log in with your @${config.company.emailDomains.join(", ")} account.`,
      };
    }

    if (rule.mode === "allow_if_tagged") {
      if (identity.email) {
        const normalizedEmail = identity.email.toLowerCase();
        if (this.matchesAccountPattern(normalizedEmail, rule.deniedAccounts)) {
          return {
            ...base,
            allowed: false,
            identity,
            reason: `Account '${identity.email}' is prohibited for corporate use.`,
          };
        }

        if (this.matchesAccountPattern(normalizedEmail, rule.allowedAccounts)) {
          return {
            ...base,
            allowed: true,
            identity,
            reason: `The '${provider}' model provider is authenticated with approved corporate account '${identity.email}'.`,
          };
        }

        const emailDomain = normalizedEmail.split("@")[1];
        const allowedDomains = (rule.allowedEmailDomains || config.company.emailDomains).map((domain) =>
          domain.toLowerCase(),
        );
        if (emailDomain && allowedDomains.includes(emailDomain)) {
          return {
            ...base,
            allowed: true,
            identity,
            reason: `The '${provider}' model provider is authenticated with a verified @${emailDomain} corporate account (${identity.email}).`,
          };
        }
      }

      const domainDesc = (rule.allowedEmailDomains || config.company.emailDomains)
        .map((domain) => `@${domain}`)
        .join(", ");
      return {
        ...base,
        allowed: false,
        identity,
        reason: `Provider '${provider}' requires a verified corporate account (${domainDesc}).`,
      };
    }

    return {
      ...base,
      allowed: false,
      reason: `Unknown policy mode for provider '${provider}'.`,
    };
  }
}
