import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceDetector } from "../src/detector.js";
import type { PolicyConfig } from "../src/types.js";

const mockConfig: PolicyConfig = {
  company: {
    name: "Acme Corporation",
    emailDomains: ["acme.corp"],
    remotePatterns: [
      "*acme.corp*",
      "github.com/acme-corp/*",
      "gitlab.acme.corp/*"
    ],
    localPathPatterns: ["*acme*", "*work*"],
  },
  workPolicy: {
    defaultBehavior: "deny",
    providers: {},
  },
  personalPolicy: {
    defaultBehavior: "allow",
  },
};

test("WorkspaceDetector - matchesRemotePattern", () => {
  const detector = new WorkspaceDetector();

  // Corporate enterprise git remotes
  assert.equal(
    detector.matchesRemotePattern("git@github.acme.corp:netops/telemetry.git", mockConfig.company.remotePatterns),
    "*acme.corp*"
  );
  assert.equal(
    detector.matchesRemotePattern("https://gitlab.acme.corp/team/core.git", mockConfig.company.remotePatterns),
    "*acme.corp*"
  );
  assert.equal(
    detector.matchesRemotePattern("https://github.com/acme-corp/sdk.git", mockConfig.company.remotePatterns),
    "github.com/acme-corp/*"
  );

  // Non-corporate / Personal / Open-source remotes
  assert.equal(
    detector.matchesRemotePattern("git@github.com:personal-user/my-game.git", mockConfig.company.remotePatterns),
    undefined
  );
  assert.equal(
    detector.matchesRemotePattern("https://github.com/vuejs/core.git", mockConfig.company.remotePatterns),
    undefined
  );
});

test("WorkspaceDetector - matchesPathPattern hierarchy containment", async () => {
  const detector = new WorkspaceDetector();

  // Matches path containing 'acme' anywhere in folder hierarchy
  const workPath1 = await detector.isWorkWorkspace("/Users/developer/dev/acme/project-a", mockConfig);
  assert.equal(workPath1.isWork, true);
  assert.equal(workPath1.matchedPattern, "*acme*");

  // Matches path containing 'work' anywhere in folder hierarchy
  const workPath2 = await detector.isWorkWorkspace("/home/user/workspaces/work/repo-1", mockConfig);
  assert.equal(workPath2.isWork, true);
  assert.equal(workPath2.matchedPattern, "*work*");

  // Matches deep nested folder under work
  const workPath3 = await detector.isWorkWorkspace("/Volumes/SecureDrive/work_client/tools/app", mockConfig);
  assert.equal(workPath3.isWork, true);

  // Evaluation failures remain visibly unknown instead of being treated as personal.
  const unavailablePath = await detector.isWorkWorkspace("/path/that/does/not/exist", mockConfig);
  assert.equal(unavailablePath.isWork, false);
  assert.equal(unavailablePath.classification, "unknown");
  assert.match(unavailablePath.warning || "", /Could not evaluate/);
});

test("WorkspaceDetector - defaults readable non-work directories to personal", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-personal-"));
  try {
    const result = await new WorkspaceDetector().isWorkWorkspace(tempDir, mockConfig);
    assert.equal(result.classification, "personal");
    assert.equal(result.isWork, false);
    assert.equal(result.isGitRepo, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("WorkspaceDetector - does not throw on glob syntax that was invalid as a regular expression", () => {
  const detector = new WorkspaceDetector();
  assert.doesNotThrow(() => detector.matchesRemotePattern(
    "https://github.com/acme-corp/sdk.git",
    ["github.com/acme-corp/["],
  ));
});

test("WorkspaceDetector - caches a workspace classification per policy fingerprint", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-policy-cache-"));
  try {
    const detector = new WorkspaceDetector();
    const personalConfig = { ...mockConfig, company: { ...mockConfig.company, localPathPatterns: [] } };
    const workConfig = {
      ...mockConfig,
      company: { ...mockConfig.company, localPathPatterns: ["*pi-policy-cache-*"] },
    };

    assert.equal((await detector.isWorkWorkspace(tempDir, personalConfig)).classification, "personal");
    assert.equal((await detector.isWorkWorkspace(tempDir, workConfig)).classification, "work");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
