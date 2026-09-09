import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigLoader, DEFAULT_CONFIG, isPolicyConfig, policyConfigValidationErrors } from "../src/config.js";

function temporaryConfigDir() {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-config-"));
  return {
    tempDir,
    projectPath: join(tempDir, ".pi", "work-policy.json"),
    globalPath: join(tempDir, "global-work-policy.json"),
  };
}

test("ConfigLoader - uses a valid project policy when the project is trusted", () => {
  const { tempDir, projectPath } = temporaryConfigDir();
  const customConfig = {
    ...DEFAULT_CONFIG,
    company: { ...DEFAULT_CONFIG.company, name: "Custom Enterprise Inc." },
  };
  mkdirSync(join(tempDir, ".pi"), { recursive: true });
  writeFileSync(projectPath, JSON.stringify(customConfig));

  const loaded = ConfigLoader.load(tempDir, { allowProjectOverride: true });
  assert.equal(loaded.config.company.name, "Custom Enterprise Inc.");
  assert.equal(loaded.source, "project");
  assert.deepEqual(loaded.warnings, []);
  rmSync(tempDir, { recursive: true, force: true });
});

test("ConfigLoader - ignores a project policy when Pi has not trusted the project", () => {
  const { tempDir, projectPath, globalPath } = temporaryConfigDir();
  mkdirSync(join(tempDir, ".pi"), { recursive: true });
  writeFileSync(projectPath, JSON.stringify({ ...DEFAULT_CONFIG, company: { ...DEFAULT_CONFIG.company, name: "Project" } }));
  writeFileSync(globalPath, JSON.stringify({ ...DEFAULT_CONFIG, company: { ...DEFAULT_CONFIG.company, name: "Global" } }));

  const loaded = ConfigLoader.load(tempDir, { globalPath, allowProjectOverride: false });
  assert.equal(loaded.config.company.name, "Global");
  assert.equal(loaded.source, "global");
  assert.match(loaded.warnings.join("\n"), /not trusted by Pi/);
  rmSync(tempDir, { recursive: true, force: true });
});

test("ConfigLoader - ignores invalid project policy and falls back to a valid global policy", () => {
  const { tempDir, projectPath, globalPath } = temporaryConfigDir();
  mkdirSync(join(tempDir, ".pi"), { recursive: true });
  writeFileSync(projectPath, JSON.stringify({ company: { name: "Incomplete" } }));
  writeFileSync(globalPath, JSON.stringify({ ...DEFAULT_CONFIG, company: { ...DEFAULT_CONFIG.company, name: "Global" } }));

  const loaded = ConfigLoader.load(tempDir, { globalPath, allowProjectOverride: true });
  assert.equal(loaded.config.company.name, "Global");
  assert.equal(loaded.source, "global");
  assert.match(loaded.warnings.join("\n"), /Ignored invalid policy configuration/);
  rmSync(tempDir, { recursive: true, force: true });
});

test("ConfigLoader - falls back to the built-in policy", () => {
  const { tempDir, globalPath } = temporaryConfigDir();
  const loaded = ConfigLoader.load(tempDir, { globalPath });
  assert.equal(loaded.config.company.name, "Enterprise");
  assert.equal(loaded.config.company.emailDomains[0], "company.com");
  assert.equal(loaded.source, "default");
  assert.equal(loaded.requiresConfigurationRepair, false);
  rmSync(tempDir, { recursive: true, force: true });
});

test("ConfigLoader - invalid global policy requires repair and identifies invalid fields", () => {
  const { tempDir, globalPath } = temporaryConfigDir();
  const staleConfig = {
    ...DEFAULT_CONFIG,
    workPolicy: {
      ...DEFAULT_CONFIG.workPolicy,
      autoSwitchToFallback: false,
      providers: {
        ...DEFAULT_CONFIG.workPolicy.providers,
        "github-copilot": {
          ...DEFAULT_CONFIG.workPolicy.providers["github-copilot"],
          allowEnterpriseSKU: true,
        },
      },
    },
  };
  writeFileSync(globalPath, JSON.stringify(staleConfig));

  const loaded = ConfigLoader.load(tempDir, { globalPath });
  assert.equal(loaded.source, "default");
  assert.equal(loaded.requiresConfigurationRepair, true);
  assert.match(loaded.warnings.join("\n"), /workPolicy\.autoSwitchToFallback is not supported/);
  assert.match(loaded.warnings.join("\n"), /workPolicy\.providers\.github-copilot\.allowEnterpriseSKU is not supported/);
  assert.deepEqual(policyConfigValidationErrors(staleConfig).length, 2);
  rmSync(tempDir, { recursive: true, force: true });
});

test("isPolicyConfig - rejects unknown and unsupported configuration fields", () => {
  assert.equal(isPolicyConfig(DEFAULT_CONFIG), true);
  assert.equal(isPolicyConfig({ ...DEFAULT_CONFIG, unexpected: true }), false);
  assert.equal(isPolicyConfig({
    ...DEFAULT_CONFIG,
    workPolicy: { ...DEFAULT_CONFIG.workPolicy, autoSwitchToFallback: true },
  }), false);
});

test("isPolicyConfig - keeps runtime validation aligned with non-empty schema fields", () => {
  assert.equal(isPolicyConfig({
    ...DEFAULT_CONFIG,
    company: { ...DEFAULT_CONFIG.company, name: "" },
  }), false);
  assert.equal(isPolicyConfig({
    ...DEFAULT_CONFIG,
    workPolicy: { ...DEFAULT_CONFIG.workPolicy, fallbackModel: "" },
  }), false);
});
