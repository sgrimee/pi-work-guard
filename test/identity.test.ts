import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IdentityResolver } from "../src/identity.js";

test("IdentityResolver - OpenAI JWT decoding", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-test-"));
  const authPath = join(tempDir, "auth.json");
  const accountsPath = join(tempDir, "accounts.json");

  // Create a mock OpenAI JWT access token
  const payload = {
    email: "developer@acme.corp",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "org-12345",
      email: "developer@acme.corp",
    },
  };
  const jwt = `header.${Buffer.from(JSON.stringify(payload)).toString("base64")}.signature`;

  writeFileSync(
    authPath,
    JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: jwt,
      },
    })
  );

  const resolver = new IdentityResolver(authPath, accountsPath);
  const identity = await resolver.resolveIdentity("openai-codex");

  assert.equal(identity.provider, "openai-codex");
  assert.equal(identity.email, "developer@acme.corp");
  assert.equal(identity.verified, true);
  assert.equal(identity.source, "jwt_claim");

  rmSync(tempDir, { recursive: true, force: true });
});

test("IdentityResolver - GitHub Copilot enterprise token inspection", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-test-"));
  const authPath = join(tempDir, "auth.json");
  const accountsPath = join(tempDir, "accounts.json");

  writeFileSync(
    authPath,
    JSON.stringify({
      "github-copilot": {
        type: "oauth",
        access: "tid=123;sku=copilot_enterprise_seat_quota;proxy-ep=proxy.enterprise.githubcopilot.com",
      },
    })
  );

  const resolver = new IdentityResolver(authPath, accountsPath);
  const identity = await resolver.resolveIdentity("github-copilot");

  assert.equal(identity.provider, "github-copilot");
  assert.equal(identity.isEnterpriseSKU, true);
  assert.equal(identity.verified, true);

  rmSync(tempDir, { recursive: true, force: true });
});

test("IdentityResolver - automatically resolves Anthropic OAuth account", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-test-"));
  const authPath = join(tempDir, "auth.json");
  const accountsPath = join(tempDir, "accounts.json");

  writeFileSync(
    authPath,
    JSON.stringify({
      anthropic: {
        type: "oauth",
        refresh: "sk-ant-ort01-work-token",
        access: "sk-ant-oat01-work-token",
      },
    })
  );

  const fakeFetch = (async (input: string | URL | Request) => {
    assert.equal(String(input), "https://api.anthropic.com/api/claude_cli/bootstrap");
    return new Response(
      JSON.stringify({
        oauth_account: {
          account_email: "developer@acme.corp",
          organization_type: "enterprise",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const resolver = new IdentityResolver(authPath, accountsPath, fakeFetch);
  const identity = await resolver.resolveIdentity("anthropic");

  assert.equal(identity.email, "developer@acme.corp");
  assert.equal(identity.verified, true);
  assert.equal(identity.source, "oauth_api");

  rmSync(tempDir, { recursive: true, force: true });
});

test("IdentityResolver - credential change invalidates Anthropic identity cache", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-test-"));
  const authPath = join(tempDir, "auth.json");
  const accountsPath = join(tempDir, "accounts.json");

  const writeCredential = (suffix: string) =>
    writeFileSync(
      authPath,
      JSON.stringify({
        anthropic: {
          type: "oauth",
          refresh: `refresh-${suffix}`,
          access: `access-${suffix}`,
        },
      })
    );

  writeCredential("work");
  const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const authorization = new Headers(init?.headers).get("authorization") || "";
    const account_email = authorization.includes("access-work")
      ? "developer@acme.corp"
      : "developer@gmail.com";
    return new Response(JSON.stringify({ oauth_account: { account_email } }), { status: 200 });
  }) as typeof fetch;

  const resolver = new IdentityResolver(authPath, accountsPath, fakeFetch);
  const workIdentity = await resolver.resolveIdentity("anthropic");
  assert.equal(workIdentity.email, "developer@acme.corp");

  writeCredential("personal");
  const personalIdentity = await resolver.resolveIdentity("anthropic");
  assert.equal(personalIdentity.email, "developer@gmail.com");

  rmSync(tempDir, { recursive: true, force: true });
});

test("IdentityResolver - manual attestation does not survive an unverified token change", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-test-"));
  const authPath = join(tempDir, "auth.json");
  const accountsPath = join(tempDir, "accounts.json");
  const failingFetch = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;

  writeFileSync(
    authPath,
    JSON.stringify({ anthropic: { type: "oauth", refresh: "refresh-1", access: "access-1" } })
  );
  const resolver = new IdentityResolver(authPath, accountsPath, failingFetch);
  assert.equal(resolver.attestAccount("anthropic", "developer@acme.corp"), true);
  assert.equal((await resolver.resolveIdentity("anthropic")).verified, true);

  writeFileSync(
    authPath,
    JSON.stringify({ anthropic: { type: "oauth", refresh: "refresh-2", access: "access-2" } })
  );
  const changed = await resolver.resolveIdentity("anthropic");
  assert.equal(changed.verified, false);

  rmSync(tempDir, { recursive: true, force: true });
});
