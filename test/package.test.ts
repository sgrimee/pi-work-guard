import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf-8")) as {
  keywords?: string[];
  files?: string[];
  pi?: { extensions?: string[] };
  peerDependencies?: Record<string, string>;
  repository?: { type?: string; url?: string };
  bugs?: { url?: string };
  homepage?: string;
};

test("package metadata exposes a Pi extension resource", () => {
  assert.ok(packageJson.keywords?.includes("pi-package"));
  assert.deepEqual(packageJson.pi?.extensions, ["./src/index.ts"]);
  assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-coding-agent"], "*");
  assert.ok(packageJson.files?.includes("src"));
  assert.ok(packageJson.files?.includes("schema.json"));
  assert.equal(existsSync(resolve("schema.json")), true);
  assert.equal(packageJson.repository?.url, "git+https://github.com/sgrimee/pi-work-guard.git");
  assert.equal(packageJson.bugs?.url, "https://github.com/sgrimee/pi-work-guard/issues");
  assert.equal(packageJson.homepage, "https://github.com/sgrimee/pi-work-guard#readme");
});
