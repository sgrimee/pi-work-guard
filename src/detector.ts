import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { minimatch } from "minimatch";
import type { PolicyConfig } from "./types.js";

const execFileAsync = promisify(execFile);

export type WorkspaceClassification = "work" | "personal" | "unknown";

export interface WorkspaceDetectionResult {
  classification: WorkspaceClassification;
  isWork: boolean;
  matchedRemote?: string;
  matchedPattern?: string;
  isGitRepo: boolean;
  warning?: string;
}

type CachedWorkspaceResult = {
  result: WorkspaceDetectionResult;
  timestamp: number;
};

function errorCode(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "number"
    ? error.code
    : undefined;
}

function errorStderr(error: unknown): string {
  return typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string"
    ? error.stderr
    : "";
}

export class WorkspaceDetector {
  private cache = new Map<string, CachedWorkspaceResult>();
  private readonly ttlMs: number;

  constructor(ttlMs = 15_000) {
    this.ttlMs = ttlMs;
  }

  /**
   * Normalizes git remote URL (converting SSH formats git@host:org/repo to https-like host/org/repo).
   */
  public normalizeRemoteUrl(url: string): string {
    let clean = url.trim().toLowerCase();
    clean = clean.replace(/\.git$/, "");
    clean = clean.replace(/^(https?|ssh|git):\/\//, "");
    clean = clean.replace(/^git@([^:]+):/, "$1/");
    return clean;
  }

  /**
   * Matches a local filesystem directory path against path/hierarchy patterns.
   * Supports globs, path segment containment, and substring matching.
   */
  public matchesPathPattern(cwd: string, pattern: string): boolean {
    const normalizedCwd = cwd.trim().toLowerCase();
    const home = homedir().toLowerCase();
    const resolvedCwd = normalizedCwd.replace(home, "~");
    const normalizedPattern = pattern.trim().toLowerCase();

    if (
      minimatch(normalizedCwd, normalizedPattern, { dot: true, nocase: true }) ||
      minimatch(resolvedCwd, normalizedPattern, { dot: true, nocase: true }) ||
      minimatch(normalizedCwd, `**/${normalizedPattern}/**`, { dot: true, nocase: true })
    ) {
      return true;
    }

    const keyword = normalizedPattern.replace(/^\*+|\*+$/g, "");
    if (keyword.length > 0) {
      const segments = normalizedCwd.split(/[\\/]/).filter(Boolean);
      for (const segment of segments) {
        if (segment === keyword || segment.includes(keyword)) {
          return true;
        }
      }
    }

    return false;
  }

  /** Matches a git remote URL against configured glob/substring patterns. */
  public matchesRemotePattern(remoteUrl: string, patterns: string[]): string | undefined {
    const raw = remoteUrl.trim().toLowerCase();
    const normalized = this.normalizeRemoteUrl(remoteUrl);

    for (const pattern of patterns) {
      const normalizedPattern = pattern.trim().toLowerCase();
      if (
        minimatch(raw, normalizedPattern, { dot: true, nocase: true }) ||
        minimatch(normalized, normalizedPattern, { dot: true, nocase: true })
      ) {
        return pattern;
      }

      const stripped = normalizedPattern.replace(/^\*+|\*+$/g, "");
      if (stripped && (raw.includes(stripped) || normalized.includes(stripped))) {
        return pattern;
      }
    }
    return undefined;
  }

  private cacheKey(cwd: string, config: PolicyConfig): string {
    return JSON.stringify({
      cwd,
      remotePatterns: config.company.remotePatterns,
      localPathPatterns: config.company.localPathPatterns ?? [],
    });
  }

  private async isGitRepository(cwd: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd,
        timeout: 2_000,
      });
      return stdout.trim() === "true";
    } catch (error) {
      // Git uses exit code 128 for a readable directory that is not a repository.
      // Other code-128 failures (for example, a corrupt or unreadable repository) are evaluation errors.
      if (errorCode(error) === 128 && /not a git repository/i.test(errorStderr(error))) return false;
      throw error;
    }
  }

  private cacheResult(key: string, result: WorkspaceDetectionResult): WorkspaceDetectionResult {
    this.cache.set(key, { result, timestamp: Date.now() });
    return result;
  }

  /** Determines if a workspace directory is a corporate work workspace. */
  public async isWorkWorkspace(cwd: string, config: PolicyConfig): Promise<WorkspaceDetectionResult> {
    const key = this.cacheKey(cwd, config);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.result;
    }

    if (config.company.localPathPatterns?.length) {
      for (const pattern of config.company.localPathPatterns) {
        if (this.matchesPathPattern(cwd, pattern)) {
          return this.cacheResult(key, {
            classification: "work",
            isWork: true,
            matchedPattern: pattern,
            isGitRepo: false,
          });
        }
      }
    }

    try {
      let remotesOutput = "";
      let isGitRepo = true;
      try {
        const { stdout } = await execFileAsync(
          "git",
          ["config", "--local", "--get-regexp", "^remote\\..*\\.url$"],
          { cwd, timeout: 2_000 },
        );
        remotesOutput = stdout;
      } catch (error) {
        // `git config --local --get-regexp` exits 1 when there are no matching remotes;
        // outside a repository Git exits 128 and reports that --local is unavailable.
        const noMatchingRemote = errorCode(error) === 1;
        const notGitRepository = errorCode(error) === 128 && /--local can only be used inside a git repository/i.test(errorStderr(error));
        if (!noMatchingRemote && !notGitRepository) throw error;
        isGitRepo = await this.isGitRepository(cwd);
      }

      const remotes = remotesOutput
        .split("\n")
        .map((line) => line.replace(/^remote\.[^.]+\.url\s+/, "").trim())
        .filter((url) => url.length > 0);

      for (const url of remotes) {
        const matchedPattern = this.matchesRemotePattern(url, config.company.remotePatterns);
        if (matchedPattern) {
          return this.cacheResult(key, {
            classification: "work",
            isWork: true,
            matchedRemote: url,
            matchedPattern,
            isGitRepo: true,
          });
        }
      }

      return this.cacheResult(key, {
        classification: "personal",
        isWork: false,
        isGitRepo,
      });
    } catch {
      return this.cacheResult(key, {
        classification: "unknown",
        isWork: false,
        isGitRepo: false,
        warning: "Could not evaluate the workspace repository; workspace classification is unknown.",
      });
    }
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
