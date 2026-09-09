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

export type PolicyConfigSource = "project" | "global" | "default";

export interface PolicyConfigLoadResult {
  config: PolicyConfig;
  source: PolicyConfigSource;
  warnings: string[];
}

export interface IdentityInfo {
  provider: string;
  email?: string;
  username?: string;
  verified: boolean;
  source: "oauth_api" | "jwt_claim" | "unknown";
}

export interface PolicyCheckResult {
  isWorkRepo: boolean;
  workspaceClassification: "work" | "personal" | "unknown";
  workspaceWarning?: string;
  allowed: boolean;
  provider: string;
  modelId: string;
  reason: string;
  matchedRemote?: string;
  identity?: IdentityInfo;
}
