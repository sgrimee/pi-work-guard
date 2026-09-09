import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WorkspaceDetector } from "./detector.js";
import { IdentityResolver } from "./identity.js";
import { PolicyEngine } from "./policy.js";
import { ConfigLoader } from "./config.js";
import type { PolicyCheckResult, PolicyConfigLoadResult } from "./types.js";

type ProviderRequestBlockContext = {
  abort(): void;
  ui: Pick<ExtensionContext["ui"], "notify">;
};

export function abortBlockedProviderRequest(
  ctx: ProviderRequestBlockContext,
  companyName: string,
  provider: string,
  reason: string,
): void {
  ctx.ui.notify(
    [
      `🛡️ Outbound request blocked by ${companyName} Policy:`,
      `Provider: ${provider}`,
      `Reason: ${reason}`,
      "Switch to an authorized work model before continuing.",
    ].join("\n"),
    "error",
  );
  ctx.abort();
}

function loadPolicy(ctx: ExtensionContext): PolicyConfigLoadResult {
  return ConfigLoader.load(ctx.cwd, {
    allowProjectOverride: ctx.isProjectTrusted(),
  });
}

function policyDiagnostics(load: PolicyConfigLoadResult): string[] {
  return [
    `Policy source: ${load.source}`,
    ...load.warnings.map((warning) => `Warning: ${warning}`),
  ];
}

function fallbackModelHint(load: PolicyConfigLoadResult): string {
  return load.config.workPolicy.fallbackModel
    ? `Switch to the configured fallback model (${load.config.workPolicy.fallbackModel}) or another authorized work model before continuing.`
    : "Switch to an authorized work model before continuing.";
}

export async function evaluatePolicy(
  engine: PolicyEngine,
  cwd: string,
  provider: string,
  modelId: string,
  load: PolicyConfigLoadResult,
): Promise<PolicyCheckResult> {
  if (load.requiresConfigurationRepair) {
    return {
      isWorkRepo: false,
      workspaceClassification: "unknown",
      workspaceWarning: "A policy configuration file is invalid or unreadable.",
      allowed: false,
      provider,
      modelId,
      reason: "Policy configuration is invalid or unreadable; provider use is blocked until it is repaired.",
    };
  }
  return engine.evaluate(cwd, provider, modelId, load.config);
}

export default function workGuardExtension(pi: ExtensionAPI) {
  const detector = new WorkspaceDetector();
  const identityResolver = new IdentityResolver();
  const engine = new PolicyEngine(detector, identityResolver);

  async function updateStatus(ctx: ExtensionContext) {
    if (!ctx.model) return;
    const load = loadPolicy(ctx);
    const result = await evaluatePolicy(engine, ctx.cwd, ctx.model.provider, ctx.model.id, load);

    if (result.workspaceClassification === "unknown") {
      ctx.ui.setStatus(
        "work-guard",
        load.requiresConfigurationRepair
          ? "🚨 Policy configuration invalid — provider use blocked"
          : "🚨 Workspace evaluation failed — provider use blocked",
      );
    } else if (!result.allowed) {
      ctx.ui.setStatus(
        "work-guard",
        `🚨 ${load.config.company.name} Policy Block: model provider '${ctx.model.provider}' not approved`,
      );
    } else if (load.warnings.length > 0) {
      ctx.ui.setStatus("work-guard", "⚠ Policy config warning — run /provider-policy status");
    } else if (result.isWorkRepo) {
      ctx.ui.setStatus("work-guard", "🛡️");
    } else {
      ctx.ui.setStatus("work-guard", "🏠");
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    ConfigLoader.initializeGlobalConfig();
    await updateStatus(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    const load = loadPolicy(ctx);
    const result = await evaluatePolicy(engine, ctx.cwd, event.model.provider, event.model.id, load);

    if (!result.allowed) {
      ctx.ui.notify(
        `⚠️ Provider Policy Alert:\nThe '${event.model.provider}' model provider (${event.model.id}) is not permitted in this workspace.\n${result.reason}`,
        "error",
      );
    }
    await updateStatus(ctx);
  });

  pi.on("input", async (_event, ctx) => {
    if (!ctx.model) return { action: "continue" as const };

    const load = loadPolicy(ctx);
    const result = await evaluatePolicy(engine, ctx.cwd, ctx.model.provider, ctx.model.id, load);

    if (!result.allowed) {
      const message = [
        `🛡️ Prompt Blocked by ${load.config.company.name} Policy:`,
        result.reason,
        "",
        `Workspace: ${result.matchedRemote || ctx.cwd}`,
        `Current Model: ${ctx.model.provider}/${ctx.model.id} (BLOCKED)`,
        "",
        result.workspaceClassification === "unknown"
          ? load.requiresConfigurationRepair
            ? "Repair the policy configuration before continuing."
            : "Resolve the workspace evaluation problem before continuing."
          : fallbackModelHint(load),
      ].join("\n");

      ctx.ui.notify(message, "error");
      return { action: "handled" as const };
    }

    return { action: "continue" as const };
  });

  pi.on("before_provider_request", async (_event, ctx) => {
    if (!ctx.model) return;

    const load = loadPolicy(ctx);
    const result = await evaluatePolicy(engine, ctx.cwd, ctx.model.provider, ctx.model.id, load);

    if (!result.allowed) {
      abortBlockedProviderRequest(
        ctx,
        load.config.company.name,
        ctx.model.provider,
        result.reason,
      );
    }
  });

  pi.registerCommand("provider-policy", {
    description: "Inspect workspace and model-provider policy status",
    handler: async (args, ctx) => {
      const load = loadPolicy(ctx);
      const config = load.config;
      const parts = (args || "").trim().split(/\s+/).filter(Boolean);
      const subCommand = parts[0]?.toLowerCase() || "status";

      if (subCommand === "reload") {
        detector.clearCache();
        identityResolver.clearCache();
        await updateStatus(ctx);
        ctx.ui.notify("Work policy configuration and caches reloaded.", "info");
        return;
      }

      if (subCommand === "check") {
        const provider = parts[1] || ctx.model?.provider;
        const modelId = parts[2] || ctx.model?.id || "default";
        if (!provider) {
          ctx.ui.notify("Usage: /provider-policy check <provider> [model]", "warning");
          return;
        }

        const result = await evaluatePolicy(engine, ctx.cwd, provider, modelId, load);
        const report = [
          `=== Work Policy Check: ${provider}/${modelId} ===`,
          `Workspace: ${result.workspaceClassification === "work" ? "🏢 Corporate Work Repo" : result.workspaceClassification === "unknown" ? "⚠️ Unknown Workspace" : "🏠 Personal Repo"}`,
          `Verdict: ${result.allowed ? "✅ PERMITTED" : "❌ PROHIBITED / BLOCKED"}`,
          `Reason: ${result.reason}`,
          ...policyDiagnostics(load),
        ];
        if (result.identity?.email) {
          report.push(`Identity: ${result.identity.email} (${result.identity.source})`);
        }
        ctx.ui.notify(report.join("\n"), result.allowed ? "info" : "error");
        return;
      }

      if (!ctx.model) {
        ctx.ui.notify("No active model selected.", "warning");
        return;
      }

      const result = await evaluatePolicy(engine, ctx.cwd, ctx.model.provider, ctx.model.id, load);
      const lines = [
        `=== ${config.company.name} Work Policy Status ===`,
        `Workspace: ${result.workspaceClassification === "work" ? `🏢 Corporate Work Repo (${result.matchedRemote || ctx.cwd})` : result.workspaceClassification === "unknown" ? `⚠️ Unknown Workspace (${result.workspaceWarning || ctx.cwd})` : "🏠 Personal Repo"}`,
        `Active Model: ${ctx.model.provider} / ${ctx.model.id}`,
        `Compliance: ${result.allowed ? "✅ COMPLIANT" : "❌ NON-COMPLIANT (BLOCKED)"}`,
        `Reason: ${result.reason}`,
        ...policyDiagnostics(load),
      ];

      if (result.identity?.email) {
        lines.push(`Account: ${result.identity.email} (${result.identity.source})`);
      }
      ctx.ui.notify(lines.join("\n"), result.allowed ? "info" : "error");
    },
  });
}
