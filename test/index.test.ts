import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import workGuardExtension, { abortBlockedProviderRequest, evaluatePolicy } from "../src/index.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { PolicyEngine } from "../src/policy.js";

test("workGuardExtension - registers the documented lifecycle hooks and command", () => {
  const events: string[] = [];
  const commands: string[] = [];
  const fakePi = {
    on: (event: string) => events.push(event),
    registerCommand: (name: string) => commands.push(name),
  } as unknown as ExtensionAPI;

  workGuardExtension(fakePi);
  assert.deepEqual(events, ["session_start", "model_select", "input", "before_provider_request"]);
  assert.deepEqual(commands, ["provider-policy"]);
});

test("evaluatePolicy - invalid configuration is an unknown, blocked workspace", async () => {
  const engine = {
    evaluate: async () => {
      throw new Error("The policy engine must not evaluate a fallback configuration.");
    },
  } as unknown as PolicyEngine;

  const result = await evaluatePolicy(engine, "/work/project", "github-copilot", "gpt-5.6-terra", {
    config: DEFAULT_CONFIG,
    source: "default",
    warnings: ["Ignored invalid policy configuration at /test/work-policy.json: workPolicy.unrecognized is not supported."],
    requiresConfigurationRepair: true,
  });

  assert.equal(result.workspaceClassification, "unknown");
  assert.equal(result.allowed, false);
  assert.match(result.reason, /configuration is invalid or unreadable/i);
});

test("abortBlockedProviderRequest - reports the policy reason and aborts the active run", () => {
  const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
  let abortCount = 0;

  abortBlockedProviderRequest(
    {
      abort: () => {
        abortCount += 1;
      },
      ui: {
        notify: (message, type) => {
          notifications.push({ message, type });
        },
      },
    },
    "Acme Corporation",
    "anthropic",
    "Account 'developer@gmail.com' is prohibited for corporate use.",
  );

  assert.equal(abortCount, 1);
  assert.deepEqual(notifications, [
    {
      message: [
        "🛡️ Outbound request blocked by Acme Corporation Policy:",
        "Provider: anthropic",
        "Reason: Account 'developer@gmail.com' is prohibited for corporate use.",
        "Switch to an authorized work model before continuing.",
      ].join("\n"),
      type: "error",
    },
  ]);
});
