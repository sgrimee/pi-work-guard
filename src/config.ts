import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { PolicyConfig } from "./types.js";

export const DEFAULT_CONFIG: PolicyConfig = {
  $schema: "https://raw.githubusercontent.com/pi-coding-agent/pi-work-guard/main/schema.json",
  company: {
    name: "Enterprise",
    emailDomains: ["company.com"],
    remotePatterns: [
      "*company.com*",
      "github.com/company/*",
      "gitlab.company.com/*"
    ],
    localPathPatterns: ["~/work/**"],
  },
  workPolicy: {
    defaultBehavior: "deny",
    fallbackModel: "github-copilot/gpt-5.4",
    autoSwitchToFallback: false,
    providers: {
      "github-copilot": {
        mode: "require_account",
        allowedEmailDomains: ["company.com"],
        allowEnterpriseSKU: true,
      },
      "openai-codex": {
        mode: "require_account",
        allowedEmailDomains: ["company.com"],
      },
      "anthropic": {
        mode: "allow_if_tagged",
        allowedEmailDomains: ["company.com"],
        deniedAccounts: ["*@gmail.com", "*@yahoo.com", "*@hotmail.com"],
      },
      "azure-openai": {
        mode: "allow",
      },
      "amazon-bedrock": {
        mode: "allow",
      },
      "opencode": {
        mode: "deny",
        reason: "The 'OpenCode Zen' provider is not approved for corporate repositories.",
      },
      "openrouter": {
        mode: "deny",
        reason: "OpenRouter external routing is prohibited on corporate repositories.",
      },
    },
  },
  personalPolicy: {
    defaultBehavior: "allow",
  },
};

export class ConfigLoader {
  public static getGlobalConfigPath(): string {
    return join(homedir(), ".pi", "agent", "work-policy.json");
  }

  public static getProjectConfigPath(cwd: string): string {
    return join(cwd, ".pi", "work-policy.json");
  }

  public static load(cwd: string, customGlobalPath?: string): PolicyConfig {
    const projectPath = this.getProjectConfigPath(cwd);
    const globalPath = customGlobalPath || this.getGlobalConfigPath();

    if (existsSync(projectPath)) {
      try {
        return JSON.parse(readFileSync(projectPath, "utf-8"));
      } catch {
        // Fall back to global config
      }
    }

    if (existsSync(globalPath)) {
      try {
        return JSON.parse(readFileSync(globalPath, "utf-8"));
      } catch {
        // Fall back to default config
      }
    }

    return DEFAULT_CONFIG;
  }

  public static initializeGlobalConfig(customGlobalPath?: string): void {
    const globalPath = customGlobalPath || this.getGlobalConfigPath();
    if (!existsSync(globalPath)) {
      try {
        mkdirSync(dirname(globalPath), { recursive: true });
        writeFileSync(globalPath, JSON.stringify(DEFAULT_CONFIG, null, 2), {
          encoding: "utf-8",
        });
      } catch {
        // Ignore initialization error
      }
    }
  }
}
