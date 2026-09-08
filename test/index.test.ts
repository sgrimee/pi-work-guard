import test from "node:test";
import assert from "node:assert/strict";
import { abortBlockedProviderRequest } from "../src/index.js";

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
    "Account 'developer@gmail.com' is prohibited for corporate use."
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
