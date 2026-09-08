export type PolicyMode = "allow" | "deny" | "require_account" | "allow_if_tagged";

export interface ProviderRule {
  /** Mode of policy enforcement for this provider */
  mode: PolicyMode;
  /** Allowed corporate email domains (e.g. ["company.com"]) */
  allowedEmailDomains?: string[];
  /** Allowed specific account emails or patterns (e.g. ["dev@company.com", "*@company.com"]) */
  allowedAccounts?: string[];
  /** Explicitly denied account emails or patterns (e.g. ["*@gmail.com"]) */
  deniedAccounts?: string[];
  /** Allow if an enterprise license/SKU is detected in the token (e.g. GitHub Copilot Enterprise) */
  allowEnterpriseSKU?: boolean;
  /** Custom explanation shown to the user when blocked */
  reason?: string;
}

export interface CompanyConfig {
  /** Organization / Company display name */
  name: string;
  /** Corporate email domains (e.g. ["company.com"]) */
  emailDomains: string[];
  /** Git remote URL patterns identifying corporate repos (e.g. ["*company.com*", "github.com/org/*"]) */
  remotePatterns: string[];
  /** Local path glob patterns identifying corporate workspaces (e.g. ["~/work/**"]) */
  localPathPatterns?: string[];
}

export interface WorkPolicyConfig {
  /** Default behavior for unlisted providers on work repositories: "deny" (recommended) or "allow" */
  defaultBehavior: "deny" | "allow";
  /** Fallback compliant model (e.g. "github-copilot/gpt-5.4") */
  fallbackModel?: string;
  /** Auto-switch to fallback model if an unauthorized model is selected */
  autoSwitchToFallback?: boolean;
  /** Per-provider policy rules */
  providers: Record<string, ProviderRule>;
}

export interface PersonalPolicyConfig {
  /** Default behavior on non-work repositories */
  defaultBehavior: "allow" | "deny";
}

export interface PolicyConfig {
  $schema?: string;
  company: CompanyConfig;
  workPolicy: WorkPolicyConfig;
  personalPolicy: PersonalPolicyConfig;
}

export interface IdentityInfo {
  provider: string;
  email?: string;
  username?: string;
  isEnterpriseSKU?: boolean;
  verified: boolean;
  source: "oauth_api" | "jwt_claim" | "token_attestation" | "config_tag" | "unknown";
}

export interface PolicyCheckResult {
  isWorkRepo: boolean;
  allowed: boolean;
  provider: string;
  modelId: string;
  reason: string;
  matchedRemote?: string;
  identity?: IdentityInfo;
}

export interface AttestedAccountEntry {
  account: string;
  tokenHash: string;
  attestedAt: number;
  lastSeenAt: number;
}

export interface AccountStore {
  accounts: Record<string, AttestedAccountEntry>;
}
