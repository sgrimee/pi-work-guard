import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WorkspaceDetector } from "./detector.js";
import { IdentityResolver } from "./identity.js";
import { PolicyEngine } from "./policy.js";
import { ConfigLoader } from "./config.js";

type ProviderRequestBlockContext = {
  abort(): void;
  ui: Pick<ExtensionContext["ui"], "notify">;
};

export function abortBlockedProviderRequest(
  ctx: ProviderRequestBlockContext,
  companyName: string,
  provider: string,
  reason: string
): void {
  ctx.ui.notify(
    [
      `🛡️ Outbound request blocked by ${companyName} Policy:`,
      `Provider: ${provider}`,
      `Reason: ${reason}`,
      "Switch to an authorized work model before continuing.",
    ].join("\n"),
    "error"
  );
  ctx.abort();
}

export default function workGuardExtension(pi: ExtensionAPI) {
  const detector = new WorkspaceDetector();
  const identityResolver = new IdentityResolver();
  const engine = new PolicyEngine(detector, identityResolver);

  // Initialize global config if missing
  ConfigLoader.initializeGlobalConfig();

  async function updateStatus(ctx: ExtensionContext) {
    if (!ctx.model) return;
    const config = ConfigLoader.load(ctx.cwd);
    const result = await engine.evaluate(ctx.cwd, ctx.model.provider, ctx.model.id, config);

    if (result.isWorkRepo) {
      if (result.allowed) {
        ctx.ui.setStatus("work-guard", "🛡️");
      } else {
        ctx.ui.setStatus(
          "work-guard",
          `🚨 ${config.company.name} Policy Block: model provider '${ctx.model.provider}' not approved`
        );
      }
    } else {
      ctx.ui.setStatus("work-guard", "🏠");
    }
  }

  // 1. Session start: check workspace and initialize status bar
  pi.on("session_start", async (_event, ctx) => {
    await updateStatus(ctx);
  });

  // 2. Model selection: validate new model choice
  pi.on("model_select", async (event, ctx) => {
    const config = ConfigLoader.load(ctx.cwd);
    const result = await engine.evaluate(ctx.cwd, event.model.provider, event.model.id, config);

    if (result.isWorkRepo && !result.allowed) {
      ctx.ui.notify(
        `⚠️ Work Policy Alert:\nThe '${event.model.provider}' model provider (${event.model.id}) is not approved for this ${config.company.name} repository.\n${result.reason}`,
        "error"
      );
    }
    await updateStatus(ctx);
  });

  // 3. Input turn interceptor: block prompt turn if policy fails
  pi.on("input", async (event, ctx) => {
    if (!ctx.model) return { action: "continue" };

    const config = ConfigLoader.load(ctx.cwd);
    const result = await engine.evaluate(ctx.cwd, ctx.model.provider, ctx.model.id, config);

    if (result.isWorkRepo && !result.allowed) {
      const message = [
        `🛡️ Prompt Blocked by ${config.company.name} Policy:`,
        result.reason,
        "",
        `Repository: ${result.matchedRemote || ctx.cwd}`,
        `Current Model: ${ctx.model.provider}/${ctx.model.id} (BLOCKED)`,
        "",
        `To continue, switch to an authorized work model (e.g. /model github-copilot/...)`,
      ].join("\n");

      ctx.ui.notify(message, "error");
      return { action: "handled" }; // Prevents prompt from being sent to LLM
    }

    return { action: "continue" };
  });

  // 4. Provider Request hook: Hard network-level safety net
  pi.on("before_provider_request", async (_event, ctx) => {
    if (!ctx.model) return;

    const config = ConfigLoader.load(ctx.cwd);
    const result = await engine.evaluate(ctx.cwd, ctx.model.provider, ctx.model.id, config);

    if (result.isWorkRepo && !result.allowed) {
      // before_provider_request exceptions are reported but intentionally swallowed by Pi.
      // Abort the active agent signal instead, before the provider transport is invoked.
      abortBlockedProviderRequest(
        ctx,
        config.company.name,
        ctx.model.provider,
        result.reason
      );
    }
  });

  // 5. Slash command: /provider-policy
  pi.registerCommand("provider-policy", {
    description: "Inspect enterprise work policy compliance status and manage attested accounts",
    handler: async (args, ctx) => {
      const config = ConfigLoader.load(ctx.cwd);
      const parts = (args || "").trim().split(/\s+/).filter(Boolean);
      const subCommand = parts[0]?.toLowerCase() || "status";

      // Subcommand: /provider-policy reload
      if (subCommand === "reload") {
        detector.clearCache();
        identityResolver.clearCache();
        await updateStatus(ctx);
        ctx.ui.notify("Work policy configuration and caches reloaded.", "info");
        return;
      }

      // Subcommand: /provider-policy account <provider> <email>
      if (subCommand === "account") {
        const provider = parts[1];
        const email = parts[2];
        if (!provider || !email) {
          ctx.ui.notify(
            "Usage: /provider-policy account <provider> <email>\nExample: /provider-policy account anthropic user@company.com",
            "warning"
          );
          return;
        }

        const ok = identityResolver.attestAccount(provider, email);
        if (ok) {
          identityResolver.clearCache();
          await updateStatus(ctx);
          ctx.ui.notify(`✅ Successfully attested '${provider}' to account '${email}'.`, "info");
        } else {
          ctx.ui.notify(
            `❌ Failed to attest '${provider}'. No active credential found in auth.json. Run /login ${provider} first.`,
            "error"
          );
        }
        return;
      }

      // Subcommand: /provider-policy check <provider> [model]
      if (subCommand === "check") {
        const provider = parts[1] || ctx.model?.provider;
        const modelId = parts[2] || ctx.model?.id || "default";
        if (!provider) {
          ctx.ui.notify("Usage: /provider-policy check <provider> [model]", "warning");
          return;
        }

        const result = await engine.evaluate(ctx.cwd, provider, modelId, config);
        const report = [
          `=== Work Policy Check: ${provider}/${modelId} ===`,
          `Workspace: ${result.isWorkRepo ? "🏢 Corporate Work Repo" : "🏠 Personal Repo"}`,
          `Verdict: ${result.allowed ? "✅ PERMITTED" : "❌ PROHIBITED / BLOCKED"}`,
          `Reason: ${result.reason}`,
        ];
        if (result.identity?.email) {
          report.push(`Identity: ${result.identity.email} (${result.identity.source})`);
        }
        ctx.ui.notify(report.join("\n"), result.allowed ? "info" : "error");
        return;
      }

      // Subcommand: /provider-policy (or /provider-policy status)
      if (!ctx.model) {
        ctx.ui.notify("No active model selected.", "warning");
        return;
      }

      const result = await engine.evaluate(ctx.cwd, ctx.model.provider, ctx.model.id, config);
      const lines = [
        `=== ${config.company.name} Work Policy Status ===`,
        `Workspace: ${result.isWorkRepo ? `🏢 Corporate Work Repo (${result.matchedRemote || ctx.cwd})` : "🏠 Personal Repo"}`,
        `Active Model: ${ctx.model.provider} / ${ctx.model.id}`,
        `Compliance: ${result.allowed ? "✅ COMPLIANT" : "❌ NON-COMPLIANT (BLOCKED)"}`,
        `Reason: ${result.reason}`,
      ];

      if (result.identity) {
        if (result.identity.email) {
          lines.push(`Account: ${result.identity.email} (${result.identity.source})`);
        }
        if (result.identity.isEnterpriseSKU) {
          lines.push(`License: Enterprise SKU Verified`);
        }
      }

      ctx.ui.notify(lines.join("\n"), result.allowed ? "info" : "error");
    },
  });
}
