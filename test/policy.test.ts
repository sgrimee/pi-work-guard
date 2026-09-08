import test from "node:test";
import assert from "node:assert/strict";
import { PolicyEngine } from "../src/policy.js";
import { WorkspaceDetector } from "../src/detector.js";
import { IdentityResolver } from "../src/identity.js";
import type { PolicyConfig } from "../src/types.js";

const config: PolicyConfig = {
  company: {
    name: "Acme Corporation",
    emailDomains: ["acme.corp", "acme.com"],
    remotePatterns: ["*acme.corp*", "github.com/acme-corp/*"],
    localPathPatterns: ["/work/**"],
  },
  workPolicy: {
    defaultBehavior: "deny",
    fallbackModel: "github-copilot/gpt-5.4",
    providers: {
      "github-copilot": {
        mode: "require_account",
        allowedEmailDomains: ["acme.corp", "acme.com"],
        allowEnterpriseSKU: true,
      },
      "openai-codex": {
        mode: "require_account",
        allowedEmailDomains: ["acme.corp", "acme.com"],
      },
      "anthropic": {
        mode: "allow_if_tagged",
        allowedEmailDomains: ["acme.corp", "acme.com"],
        deniedAccounts: ["*@gmail.com"],
      },
      "azure-openai": {
        mode: "allow",
      },
      "opencode": {
        mode: "deny",
        reason: "The 'OpenCode Zen' provider is not approved on Acme Corporation repositories.",
      },
      "openrouter": {
        mode: "deny",
      },
    },
  },
  personalPolicy: {
    defaultBehavior: "allow",
  },
};

test("PolicyEngine - Personal workspace allows all providers", async () => {
  const detector = new WorkspaceDetector();
  const identity = new IdentityResolver();
  const engine = new PolicyEngine(detector, identity);

  const res1 = await engine.evaluate("/personal/project", "opencode", "gemini-3.7-flash", config);
  assert.equal(res1.isWorkRepo, false);
  assert.equal(res1.allowed, true);

  const res2 = await engine.evaluate("/personal/project", "openrouter", "claude-3-opus", config);
  assert.equal(res2.isWorkRepo, false);
  assert.equal(res2.allowed, true);
});

test("PolicyEngine - Work workspace blocks denied providers (opencode, openrouter)", async () => {
  const detector = new WorkspaceDetector();
  const identity = new IdentityResolver();
  const engine = new PolicyEngine(detector, identity);

  const res1 = await engine.evaluate("/work/acme-app", "opencode", "gemini-3.7-flash", config);
  assert.equal(res1.isWorkRepo, true);
  assert.equal(res1.allowed, false);
  assert.match(res1.reason, /OpenCode Zen.*provider is not approved/i);

  const res2 = await engine.evaluate("/work/acme-app", "openrouter", "claude-3-opus", config);
  assert.equal(res2.isWorkRepo, true);
  assert.equal(res2.allowed, false);
});

test("PolicyEngine - Work workspace allows explicit allow providers", async () => {
  const detector = new WorkspaceDetector();
  const identity = new IdentityResolver();
  const engine = new PolicyEngine(detector, identity);

  const res = await engine.evaluate("/work/acme-app", "azure-openai", "gpt-4o", config);
  assert.equal(res.isWorkRepo, true);
  assert.equal(res.allowed, true);
});

test("PolicyEngine - Work workspace enforces corporate account domain for OpenAI", async () => {
  const detector = new WorkspaceDetector();
  
  // Mock identity resolver returning corporate domain email
  const corpIdentity = {
    resolveIdentity: async () => ({
      provider: "openai-codex",
      email: "engineer@acme.corp",
      verified: true,
      source: "jwt_claim" as const,
    }),
  } as unknown as IdentityResolver;

  const engine1 = new PolicyEngine(detector, corpIdentity);
  const pass = await engine1.evaluate("/work/acme-app", "openai-codex", "gpt-5.3-codex", config);
  assert.equal(pass.isWorkRepo, true);
  assert.equal(pass.allowed, true);

  // Mock identity resolver returning personal email
  const personalIdentity = {
    resolveIdentity: async () => ({
      provider: "openai-codex",
      email: "engineer@gmail.com",
      verified: true,
      source: "jwt_claim" as const,
    }),
  } as unknown as IdentityResolver;

  const engine2 = new PolicyEngine(detector, personalIdentity);
  const block = await engine2.evaluate("/work/acme-app", "openai-codex", "gpt-5.3-codex", config);
  assert.equal(block.isWorkRepo, true);
  assert.equal(block.allowed, false);
  assert.match(block.reason, /does not belong to Acme Corporation/i);
});

test("PolicyEngine - Work workspace enforces Anthropic allowed domain vs denied accounts", async () => {
  const detector = new WorkspaceDetector();

  // Corporate work account
  const corpIdentity = {
    resolveIdentity: async () => ({
      provider: "anthropic",
      email: "engineer@acme.corp",
      verified: true,
      source: "token_attestation" as const,
    }),
  } as unknown as IdentityResolver;

  const engine1 = new PolicyEngine(detector, corpIdentity);
  const pass = await engine1.evaluate("/work/acme-app", "anthropic", "claude-sonnet-4-5", config);
  assert.equal(pass.isWorkRepo, true);
  assert.equal(pass.allowed, true);

  // Personal Gmail account
  const gmailIdentity = {
    resolveIdentity: async () => ({
      provider: "anthropic",
      email: "engineer@gmail.com",
      verified: true,
      source: "token_attestation" as const,
    }),
  } as unknown as IdentityResolver;

  const engine2 = new PolicyEngine(detector, gmailIdentity);
  const block = await engine2.evaluate("/work/acme-app", "anthropic", "claude-sonnet-4-5", config);
  assert.equal(block.isWorkRepo, true);
  assert.equal(block.allowed, false);
  assert.match(block.reason, /prohibited/i);
});
