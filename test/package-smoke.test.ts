import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: "pipe" });
}

test("packed package loads through Pi with production dependencies", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-work-guard-package-"));
  try {
    run("npm", ["pack", "--pack-destination", tempDir, "--ignore-scripts"], repositoryRoot);
    const tarball = readdirSync(tempDir).find((file) => file.endsWith(".tgz"));
    assert.ok(tarball, "npm pack should create a tarball");

    const unpacked = join(tempDir, "unpacked");
    mkdirSync(unpacked);
    run("tar", ["-xzf", join(tempDir, tarball), "-C", unpacked], repositoryRoot);
    const packageDir = join(unpacked, "package");
    run("npm", ["install", "--omit=dev", "--ignore-scripts", "--package-lock=false", "--no-audit", "--no-fund"], packageDir);

    const pi = join(repositoryRoot, "node_modules", ".bin", "pi");
    assert.ok(existsSync(pi), "Pi CLI must be installed for the package smoke test");
    const result = spawnSync(
      pi,
      [
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-context-files",
        "--no-session",
        "--no-tools",
        "-e",
        packageDir,
        "--list-models",
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf-8",
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: join(tempDir, "agent"),
          PI_OFFLINE: "1",
        },
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.error, undefined, `Pi failed to start: ${result.error?.message || "unknown error"}`);
    assert.equal(result.status, 0, output);
    assert.doesNotMatch(output, /Failed to load extension|Cannot find module|ERR_MODULE_NOT_FOUND/i);
    assert.match(output, /No models available|provider\s+model/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
