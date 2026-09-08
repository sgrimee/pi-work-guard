import test from "node:test";
import assert from "node:assert/strict";
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

  // Personal path without acme or work keywords
  const personalPath = await detector.isWorkWorkspace("/Users/developer/dev/personal/games", mockConfig);
  assert.equal(personalPath.isWork, false);
});
