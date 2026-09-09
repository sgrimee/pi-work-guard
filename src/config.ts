import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { PolicyConfig, PolicyConfigLoadResult, ProviderRule } from "./types.js";

export const DEFAULT_CONFIG: PolicyConfig = {
  company: {
    name: "Enterprise",
    emailDomains: ["company.com"],
    remotePatterns: [
      "*company.com*",
      "github.com/company/*",
      "gitlab.company.com/*",
    ],
    localPathPatterns: ["~/work/**"],
  },
  workPolicy: {
    defaultBehavior: "deny",
    fallbackModel: "github-copilot/gpt-5.4",
    providers: {
      "github-copilot": {
        mode: "require_account",
        allowedEmailDomains: ["company.com"],
      },
      "openai-codex": {
        mode: "require_account",
        allowedEmailDomains: ["company.com"],
      },
      anthropic: {
        mode: "allow_if_tagged",
        allowedEmailDomains: ["company.com"],
        deniedAccounts: ["*@gmail.com", "*@yahoo.com", "*@hotmail.com"],
      },
      "azure-openai": { mode: "allow" },
      "amazon-bedrock": { mode: "allow" },
      opencode: {
        mode: "deny",
        reason: "The 'OpenCode Zen' provider is not approved for corporate repositories.",
      },
      openrouter: {
        mode: "deny",
        reason: "OpenRouter external routing is prohibited on corporate repositories.",
      },
    },
  },
  personalPolicy: { defaultBehavior: "allow" },
};

export interface ConfigLoadOptions {
  globalPath?: string;
  allowProjectOverride?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateObject(
  value: unknown,
  path: string,
  requiredKeys: string[],
  allowedKeys: string[],
  errors: string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return false;
  }

  for (const key of requiredKeys) {
    if (!(key in value)) errors.push(`${path}.${key} is required.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      errors.push(`${path}.${key} is not supported (allowed: ${allowedKeys.join(", ")}).`);
    }
  }
  return true;
}

function validateStringArray(value: unknown, path: string, errors: string[], allowEmpty = false): void {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    errors.push(`${path} must be ${allowEmpty ? "an array" : "a non-empty array"} of non-empty strings.`);
  }
}

function validateProviderRule(value: unknown, path: string, errors: string[]): void {
  if (!validateObject(value, path, ["mode"], ["mode", "allowedEmailDomains", "allowedAccounts", "deniedAccounts", "reason"], errors)) return;
  if (!( ["allow", "deny", "require_account", "allow_if_tagged"] as const).includes(value.mode as ProviderRule["mode"])) {
    errors.push(`${path}.mode must be one of: allow, deny, require_account, allow_if_tagged.`);
  }
  if (value.allowedEmailDomains !== undefined) validateStringArray(value.allowedEmailDomains, `${path}.allowedEmailDomains`, errors);
  if (value.allowedAccounts !== undefined) validateStringArray(value.allowedAccounts, `${path}.allowedAccounts`, errors, true);
  if (value.deniedAccounts !== undefined) validateStringArray(value.deniedAccounts, `${path}.deniedAccounts`, errors, true);
  if (value.reason !== undefined && typeof value.reason !== "string") errors.push(`${path}.reason must be a string.`);
}

/** Return user-actionable validation errors for an untrusted policy JSON object. */
export function policyConfigValidationErrors(value: unknown): string[] {
  const errors: string[] = [];
  if (!validateObject(value, "policy", ["company", "workPolicy", "personalPolicy"], ["$schema", "company", "workPolicy", "personalPolicy"], errors)) {
    return errors;
  }

  if (value.$schema !== undefined && typeof value.$schema !== "string") {
    errors.push("policy.$schema must be a string.");
  }

  const company = value.company;
  if (validateObject(company, "company", ["name", "emailDomains", "remotePatterns"], ["name", "emailDomains", "remotePatterns", "localPathPatterns"], errors)) {
    if (typeof company.name !== "string" || company.name.length === 0) errors.push("company.name must be a non-empty string.");
    validateStringArray(company.emailDomains, "company.emailDomains", errors);
    validateStringArray(company.remotePatterns, "company.remotePatterns", errors);
    if (company.localPathPatterns !== undefined) validateStringArray(company.localPathPatterns, "company.localPathPatterns", errors, true);
  }

  const workPolicy = value.workPolicy;
  if (validateObject(workPolicy, "workPolicy", ["defaultBehavior", "providers"], ["defaultBehavior", "fallbackModel", "providers"], errors)) {
    if (!( ["allow", "deny"] as const).includes(workPolicy.defaultBehavior as "allow" | "deny")) {
      errors.push("workPolicy.defaultBehavior must be either allow or deny.");
    }
    if (workPolicy.fallbackModel !== undefined && (typeof workPolicy.fallbackModel !== "string" || workPolicy.fallbackModel.length === 0)) {
      errors.push("workPolicy.fallbackModel must be a non-empty string.");
    }
    if (!isRecord(workPolicy.providers)) {
      errors.push("workPolicy.providers must be an object.");
    } else {
      for (const [provider, rule] of Object.entries(workPolicy.providers)) {
        validateProviderRule(rule, `workPolicy.providers.${provider}`, errors);
      }
    }
  }

  const personalPolicy = value.personalPolicy;
  if (validateObject(personalPolicy, "personalPolicy", ["defaultBehavior"], ["defaultBehavior"], errors)) {
    if (!( ["allow", "deny"] as const).includes(personalPolicy.defaultBehavior as "allow" | "deny")) {
      errors.push("personalPolicy.defaultBehavior must be either allow or deny.");
    }
  }

  return errors;
}

/** Validate untrusted JSON before it reaches workspace or policy evaluation. */
export function isPolicyConfig(value: unknown): value is PolicyConfig {
  return policyConfigValidationErrors(value).length === 0;
}

function readPolicyFile(path: string): { config?: PolicyConfig; warning?: string } {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    const errors = policyConfigValidationErrors(parsed);
    if (errors.length > 0) {
      return { warning: `Ignored invalid policy configuration at ${path}: ${errors.join(" ")}` };
    }
    return { config: parsed as PolicyConfig };
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
    return { warning: `Ignored unreadable policy configuration at ${path}.${detail}` };
  }
}

export class ConfigLoader {
  public static getGlobalConfigPath(): string {
    return join(getAgentDir(), "work-policy.json");
  }

  public static getProjectConfigPath(cwd: string): string {
    return join(cwd, CONFIG_DIR_NAME, "work-policy.json");
  }

  /**
   * Loads a complete policy. A trusted project override intentionally replaces,
   * rather than merges with, the global policy so users can handle repository edge cases.
   */
  public static load(cwd: string, options: ConfigLoadOptions = {}): PolicyConfigLoadResult {
    const projectPath = this.getProjectConfigPath(cwd);
    const globalPath = options.globalPath || this.getGlobalConfigPath();
    const warnings: string[] = [];
    let invalidPolicyFound = false;

    if (existsSync(projectPath)) {
      if (options.allowProjectOverride !== false) {
        const project = readPolicyFile(projectPath);
        if (project.config) return { config: project.config, source: "project", warnings, requiresConfigurationRepair: false };
        if (project.warning) {
          warnings.push(project.warning);
          invalidPolicyFound = true;
        }
      } else {
        warnings.push(`Ignored project policy at ${projectPath} because the project is not trusted by Pi.`);
      }
    }

    if (existsSync(globalPath)) {
      const global = readPolicyFile(globalPath);
      if (global.config) return { config: global.config, source: "global", warnings, requiresConfigurationRepair: false };
      if (global.warning) {
        warnings.push(global.warning);
        invalidPolicyFound = true;
      }
    }

    return {
      config: DEFAULT_CONFIG,
      source: "default",
      warnings,
      requiresConfigurationRepair: invalidPolicyFound,
    };
  }

  public static initializeGlobalConfig(customGlobalPath?: string): void {
    const globalPath = customGlobalPath || this.getGlobalConfigPath();
    if (!existsSync(globalPath)) {
      try {
        mkdirSync(dirname(globalPath), { recursive: true });
        writeFileSync(globalPath, JSON.stringify(DEFAULT_CONFIG, null, 2), {
          encoding: "utf-8",
          mode: 0o600,
        });
      } catch {
        // The extension can still operate using its built-in default configuration.
      }
    }
  }
}
