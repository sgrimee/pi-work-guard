import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigLoader, DEFAULT_CONFIG } from "../src/config.js";

test("ConfigLoader - loads project-local config over global", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-config-"));
  const dotPiDir = join(tempDir, ".pi");
  
  const customConfig = {
    ...DEFAULT_CONFIG,
    company: {
      ...DEFAULT_CONFIG.company,
      name: "Custom Enterprise Inc.",
    },
  };

  mkdirSync(dotPiDir, { recursive: true });
  writeFileSync(join(dotPiDir, "work-policy.json"), JSON.stringify(customConfig));

  const loaded = ConfigLoader.load(tempDir);
  assert.equal(loaded.company.name, "Custom Enterprise Inc.");

  rmSync(tempDir, { recursive: true, force: true });
});

test("ConfigLoader - falls back to default configuration", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-config-empty-"));
  const nonExistentGlobal = join(tempDir, "non-existent-global.json");
  const loaded = ConfigLoader.load(tempDir, nonExistentGlobal);
  assert.equal(loaded.company.name, "Enterprise");
  assert.equal(loaded.company.emailDomains[0], "company.com");
  rmSync(tempDir, { recursive: true, force: true });
});
