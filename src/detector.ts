import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { minimatch } from "minimatch";
import type { PolicyConfig } from "./types.js";

const execFileAsync = promisify(execFile);

export interface WorkspaceDetectionResult {
  isWork: boolean;
  matchedRemote?: string;
  matchedPattern?: string;
  isGitRepo: boolean;
}

export class WorkspaceDetector {
  private cache = new Map<string, { result: WorkspaceDetectionResult; timestamp: number }>();
  private readonly ttlMs: number;

  constructor(ttlMs = 15_000) {
    this.ttlMs = ttlMs;
  }

  /**
   * Normalizes git remote URL (converting SSH formats git@host:org/repo to https-like host/org/repo).
   */
  public normalizeRemoteUrl(url: string): string {
    let clean = url.trim().toLowerCase();
    // Strip trailing .git
    clean = clean.replace(/\.git$/, "");
    // Strip protocol prefixes: https://, http://, ssh://, git://
    clean = clean.replace(/^(https?|ssh|git):\/\//, "");
    // Convert SSH git@host:org/repo to host/org/repo
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

    // 1. Direct glob matching
    if (
      minimatch(normalizedCwd, normalizedPattern, { dot: true, nocase: true }) ||
      minimatch(resolvedCwd, normalizedPattern, { dot: true, nocase: true }) ||
      minimatch(normalizedCwd, `**/${normalizedPattern}/**`, { dot: true, nocase: true })
    ) {
      return true;
    }

    // 2. Path hierarchy segment matching (e.g. "company" or "*company*" matches any folder segment containing "company")
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

  /**
   * Matches a git remote URL against configured glob/substring patterns.
   */
  public matchesRemotePattern(remoteUrl: string, patterns: string[]): string | undefined {
    const raw = remoteUrl.trim().toLowerCase();
    const normalized = this.normalizeRemoteUrl(remoteUrl);

    for (const pattern of patterns) {
      const normalizedPattern = pattern.trim().toLowerCase();

      // 1. Direct glob matching via minimatch against raw and normalized
      if (
        minimatch(raw, normalizedPattern, { dot: true, nocase: true }) ||
        minimatch(normalized, normalizedPattern, { dot: true, nocase: true })
      ) {
        return pattern;
      }

      // 2. Substring matching for stripped wildcards (e.g. "*company.com*" -> "company.com")
      const stripped = normalizedPattern.replace(/^\*+|\*+$/g, "");
      if (stripped && (raw.includes(stripped) || normalized.includes(stripped))) {
        return pattern;
      }

      // 3. GitHub / GitLab organization matching (e.g. "github.com/org/*")
      if (normalizedPattern.includes("/")) {
        const regexPattern = normalizedPattern
          .replace(/\./g, "\\.")
          .replace(/\*/g, ".*");
        if (new RegExp(regexPattern, "i").test(normalized) || new RegExp(regexPattern, "i").test(raw)) {
          return pattern;
        }
      }
    }
    return undefined;
  }

  /**
   * Determines if a workspace directory is a corporate work workspace.
   */
  public async isWorkWorkspace(cwd: string, config: PolicyConfig): Promise<WorkspaceDetectionResult> {
    const cached = this.cache.get(cwd);
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.result;
    }

    // 1. Check local path hierarchy patterns (e.g. "*work*", "*company*", "~/work/**")
    if (config.company.localPathPatterns?.length) {
      for (const pattern of config.company.localPathPatterns) {
        if (this.matchesPathPattern(cwd, pattern)) {
          const result: WorkspaceDetectionResult = {
            isWork: true,
            matchedPattern: pattern,
            isGitRepo: false,
          };
          this.cache.set(cwd, { result, timestamp: Date.now() });
          return result;
        }
      }
    }

    // 2. Query git remotes
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["config", "--get-regexp", "^remote\\..*\\.url$"],
        { cwd, timeout: 2000 }
      );

      const remotes = stdout
        .split("\n")
        .map((line) => line.replace(/^remote\.[^.]+\.url\s+/, "").trim())
        .filter((url) => url.length > 0);

      for (const url of remotes) {
        const matchedPattern = this.matchesRemotePattern(url, config.company.remotePatterns);
        if (matchedPattern) {
          const result: WorkspaceDetectionResult = {
            isWork: true,
            matchedRemote: url,
            matchedPattern,
            isGitRepo: true,
          };
          this.cache.set(cwd, { result, timestamp: Date.now() });
          return result;
        }
      }

      const result: WorkspaceDetectionResult = {
        isWork: false,
        isGitRepo: true,
      };
      this.cache.set(cwd, { result, timestamp: Date.now() });
      return result;
    } catch {
      // Not a git repository or git binary not available
      const result: WorkspaceDetectionResult = {
        isWork: false,
        isGitRepo: false,
      };
      this.cache.set(cwd, { result, timestamp: Date.now() });
      return result;
    }
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
