import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IdentityResolver } from "../src/identity.js";

function temporaryAuthPath() {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-test-"));
  return { tempDir, authPath: join(tempDir, "auth.json") };
}

test("IdentityResolver - reads a non-expired OpenAI JWT email claim", async () => {
  const { tempDir, authPath } = temporaryAuthPath();
  const payload = {
    exp: Math.floor(Date.now() / 1_000) + 3_600,
    email: "developer@acme.corp",
    "https://api.openai.com/auth": { chatgpt_account_id: "org-12345" },
  };
  const jwt = `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
  writeFileSync(authPath, JSON.stringify({ "openai-codex": { type: "oauth", access: jwt } }));

  const identity = await new IdentityResolver(authPath).resolveIdentity("openai-codex");
  assert.equal(identity.email, "developer@acme.corp");
  assert.equal(identity.verified, true);
  assert.equal(identity.source, "jwt_claim");
  rmSync(tempDir, { recursive: true, force: true });
});

test("IdentityResolver - rejects an expired OpenAI JWT email claim", async () => {
  const { tempDir, authPath } = temporaryAuthPath();
  const payload = { exp: Math.floor(Date.now() / 1_000) - 1, email: "developer@acme.corp" };
  const jwt = `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
  writeFileSync(authPath, JSON.stringify({ "openai-codex": { type: "oauth", access: jwt } }));

  const identity = await new IdentityResolver(authPath).resolveIdentity("openai-codex");
  assert.equal(identity.verified, false);
  assert.equal(identity.email, undefined);
  rmSync(tempDir, { recursive: true, force: true });
});

test("IdentityResolver - requires a GitHub profile response and does not trust token markers", async () => {
  const { tempDir, authPath } = temporaryAuthPath();
  writeFileSync(authPath, JSON.stringify({
    "github-copilot": {
      type: "oauth",
      refresh: "github-refresh-token",
      access: "sku=copilot_enterprise_seat_quota",
    },
  }));
  const fakeFetch = (async () => new Response(
    JSON.stringify({ email: "developer@acme.corp", login: "developer" }),
    { status: 200 },
  )) as typeof fetch;

  const identity = await new IdentityResolver(authPath, fakeFetch).resolveIdentity("github-copilot");
  assert.equal(identity.email, "developer@acme.corp");
  assert.equal(identity.username, "developer");
  assert.equal(identity.verified, true);
  assert.equal("isEnterpriseSKU" in identity, false);
  rmSync(tempDir, { recursive: true, force: true });
});

test("IdentityResolver - automatically resolves Anthropic OAuth account", async () => {
  const { tempDir, authPath } = temporaryAuthPath();
  writeFileSync(authPath, JSON.stringify({
    anthropic: { type: "oauth", refresh: "refresh-token", access: "access-token" },
  }));
  const fakeFetch = (async (input: string | URL | Request) => {
    assert.equal(String(input), "https://api.anthropic.com/api/claude_cli/bootstrap");
    return new Response(JSON.stringify({ oauth_account: { account_email: "developer@acme.corp" } }), { status: 200 });
  }) as typeof fetch;

  const identity = await new IdentityResolver(authPath, fakeFetch).resolveIdentity("anthropic");
  assert.equal(identity.email, "developer@acme.corp");
  assert.equal(identity.verified, true);
  assert.equal(identity.source, "oauth_api");
  rmSync(tempDir, { recursive: true, force: true });
});

test("IdentityResolver - credential change invalidates Anthropic identity cache", async () => {
  const { tempDir, authPath } = temporaryAuthPath();
  const writeCredential = (suffix: string) => writeFileSync(authPath, JSON.stringify({
    anthropic: { type: "oauth", refresh: `refresh-${suffix}`, access: `access-${suffix}` },
  }));
  writeCredential("work");
  const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const authorization = new Headers(init?.headers).get("authorization") || "";
    const account_email = authorization.includes("access-work")
      ? "developer@acme.corp"
      : "developer@gmail.com";
    return new Response(JSON.stringify({ oauth_account: { account_email } }), { status: 200 });
  }) as typeof fetch;

  const resolver = new IdentityResolver(authPath, fakeFetch);
  assert.equal((await resolver.resolveIdentity("anthropic")).email, "developer@acme.corp");
  writeCredential("personal");
  assert.equal((await resolver.resolveIdentity("anthropic")).email, "developer@gmail.com");
  rmSync(tempDir, { recursive: true, force: true });
});

test("IdentityResolver - uses a GitHub Enterprise profile endpoint for Enterprise Copilot credentials", async () => {
  const { tempDir, authPath } = temporaryAuthPath();
  writeFileSync(authPath, JSON.stringify({
    "github-copilot": {
      type: "oauth",
      refresh: "enterprise-refresh-token",
      access: "enterprise-access-token",
      enterpriseUrl: "github.acme.corp",
    },
  }));
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://github.acme.corp/api/v3/user");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer enterprise-refresh-token");
    return new Response(JSON.stringify({ email: "developer@acme.corp", login: "developer" }), { status: 200 });
  }) as typeof fetch;

  const identity = await new IdentityResolver(authPath, fakeFetch).resolveIdentity("github-copilot");
  assert.equal(identity.email, "developer@acme.corp");
  assert.equal(identity.verified, true);
  rmSync(tempDir, { recursive: true, force: true });
});

test("IdentityResolver - does not send a Copilot refresh token to an invalid Enterprise URL", async () => {
  const { tempDir, authPath } = temporaryAuthPath();
  writeFileSync(authPath, JSON.stringify({
    "github-copilot": { type: "oauth", refresh: "enterprise-refresh-token", enterpriseUrl: "http://github.acme.corp" },
  }));
  const fakeFetch = (async () => {
    assert.fail("fetch must not be called for an invalid Enterprise URL");
  }) as typeof fetch;

  const identity = await new IdentityResolver(authPath, fakeFetch).resolveIdentity("github-copilot");
  assert.equal(identity.verified, false);
  rmSync(tempDir, { recursive: true, force: true });
});

test("IdentityResolver - opaque or unavailable identities remain unverified", async () => {
  const { tempDir, authPath } = temporaryAuthPath();
  writeFileSync(authPath, JSON.stringify({
    anthropic: { type: "api_key", key: "personal-api-key" },
  }));

  const identity = await new IdentityResolver(authPath).resolveIdentity("anthropic");
  assert.equal(identity.verified, false);
  assert.equal(identity.email, undefined);
  rmSync(tempDir, { recursive: true, force: true });
});
