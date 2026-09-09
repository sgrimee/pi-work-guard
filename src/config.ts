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

function isStringArray(value: unknown, allowEmpty = false): value is string[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every((item) => typeof item === "string" && item.length > 0)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isProviderRule(value: unknown): value is ProviderRule {
  if (!isRecord(value) || !hasOnlyKeys(value, ["mode", "allowedEmailDomains", "allowedAccounts", "deniedAccounts", "reason"])) return false;
  if (!(["allow", "deny", "require_account", "allow_if_tagged"] as const).includes(value.mode as ProviderRule["mode"])) {
    return false;
  }
  return (
    (value.allowedEmailDomains === undefined || isStringArray(value.allowedEmailDomains)) &&
    (value.allowedAccounts === undefined || isStringArray(value.allowedAccounts, true)) &&
    (value.deniedAccounts === undefined || isStringArray(value.deniedAccounts, true)) &&
    (value.reason === undefined || typeof value.reason === "string")
  );
}

/** Validate untrusted JSON before it reaches workspace or policy evaluation. */
export function isPolicyConfig(value: unknown): value is PolicyConfig {
  if (!isRecord(value) || !hasOnlyKeys(value, ["$schema", "company", "workPolicy", "personalPolicy"])) return false;
  const { company, workPolicy, personalPolicy } = value;
  if (
    !isRecord(company) ||
    !isRecord(workPolicy) ||
    !isRecord(personalPolicy) ||
    !hasOnlyKeys(company, ["name", "emailDomains", "remotePatterns", "localPathPatterns"]) ||
    !hasOnlyKeys(workPolicy, ["defaultBehavior", "fallbackModel", "providers"]) ||
    !hasOnlyKeys(personalPolicy, ["defaultBehavior"])
  ) return false;
  if (
    !isNonEmptyString(company.name) ||
    !isStringArray(company.emailDomains) ||
    !isStringArray(company.remotePatterns) ||
    (company.localPathPatterns !== undefined && !isStringArray(company.localPathPatterns, true))
  ) {
    return false;
  }
  if (
    !(["allow", "deny"] as const).includes(workPolicy.defaultBehavior as "allow" | "deny") ||
    !isRecord(workPolicy.providers) ||
    (workPolicy.fallbackModel !== undefined && !isNonEmptyString(workPolicy.fallbackModel))
  ) {
    return false;
  }
  if (!Object.values(workPolicy.providers).every(isProviderRule)) return false;
  return (["allow", "deny"] as const).includes(personalPolicy.defaultBehavior as "allow" | "deny");
}

function readPolicyFile(path: string): { config?: PolicyConfig; warning?: string } {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!isPolicyConfig(parsed)) {
      return { warning: `Ignored invalid policy configuration at ${path}.` };
    }
    return { config: parsed };
  } catch {
    return { warning: `Ignored unreadable policy configuration at ${path}.` };
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

    if (existsSync(projectPath)) {
      if (options.allowProjectOverride !== false) {
        const project = readPolicyFile(projectPath);
        if (project.config) return { config: project.config, source: "project", warnings };
        if (project.warning) warnings.push(project.warning);
      } else {
        warnings.push(`Ignored project policy at ${projectPath} because the project is not trusted by Pi.`);
      }
    }

    if (existsSync(globalPath)) {
      const global = readPolicyFile(globalPath);
      if (global.config) return { config: global.config, source: "global", warnings };
      if (global.warning) warnings.push(global.warning);
    }

    return { config: DEFAULT_CONFIG, source: "default", warnings };
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
