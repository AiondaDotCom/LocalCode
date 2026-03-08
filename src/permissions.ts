import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  PermissionLevel,
  type PermissionLevelValue,
  type PermissionsConfig,
  type TestingMode,
  type PermissionResponse,
} from "./types.js";

export type PermissionPrompter = (message: string) => Promise<string>;

const ALLOWED_TOOLS_FILE = path.join(os.homedir(), ".localcode", "allowed_tools.json");

const DEFAULT_TOOL_PERMISSIONS: Record<string, PermissionLevelValue> = {
  // SAFE
  file_read: PermissionLevel.SAFE,
  grep_search: PermissionLevel.SAFE,
  web_fetch: PermissionLevel.SAFE,
  web_search: PermissionLevel.SAFE,
  web_open: PermissionLevel.SAFE,
  web_find: PermissionLevel.SAFE,
  glob: PermissionLevel.SAFE,
  list: PermissionLevel.SAFE,
  todoread: PermissionLevel.SAFE,
  // DANGEROUS
  file_write: PermissionLevel.DANGEROUS,
  file_edit: PermissionLevel.DANGEROUS,
  shell_exec: PermissionLevel.DANGEROUS,
  file_delete: PermissionLevel.DANGEROUS,
  todowrite: PermissionLevel.DANGEROUS,
  task: PermissionLevel.DANGEROUS,
};

export class Permissions {
  private permissions: Record<string, PermissionLevelValue>;
  private testingMode: TestingMode = "interactive";
  private rememberedPermissions: Set<string> = new Set();
  private skipAllPermissions = false;
  private prompter: PermissionPrompter | null = null;

  constructor(config?: PermissionsConfig) {
    this.permissions = { ...DEFAULT_TOOL_PERMISSIONS };

    if (config) {
      for (const tool of config.safe_auto_allow) {
        this.permissions[tool] = PermissionLevel.SAFE;
      }
      for (const tool of config.dangerous_confirm) {
        this.permissions[tool] = PermissionLevel.DANGEROUS;
      }
      for (const tool of config.blocked) {
        this.permissions[tool] = PermissionLevel.BLOCKED;
      }
    }

    this.loadAllowedTools();
  }

  setDangerouslySkipPermissions(skip: boolean): void {
    this.skipAllPermissions = skip;
  }

  setPrompter(prompter: PermissionPrompter): void {
    this.prompter = prompter;
  }

  getPermission(tool: string): PermissionLevelValue {
    return this.permissions[tool] ?? PermissionLevel.DANGEROUS;
  }

  setPermission(tool: string, level: PermissionLevelValue): void {
    this.permissions[tool] = level;
  }

  isSafe(tool: string): boolean {
    return this.getPermission(tool) === PermissionLevel.SAFE;
  }

  isDangerous(tool: string): boolean {
    return this.getPermission(tool) === PermissionLevel.DANGEROUS;
  }

  isBlocked(tool: string): boolean {
    return this.getPermission(tool) === PermissionLevel.BLOCKED;
  }

  setTestingMode(mode: TestingMode): void {
    this.testingMode = mode;
  }

  async requestPermission(tool: string, args?: string): Promise<boolean> {
    if (this.isBlocked(tool)) {
      return false;
    }

    if (this.isSafe(tool)) {
      return true;
    }

    if (this.skipAllPermissions) {
      return this.countdownAllow(tool, args);
    }

    if (this.rememberedPermissions.has(tool)) {
      return true;
    }

    if (this.testingMode === "auto_yes") {
      return true;
    }
    if (this.testingMode === "auto_no") {
      return false;
    }

    return this.promptUser(tool, args);
  }

  /**
   * 3-second countdown for --dangerously-skip-permissions mode.
   * Shows the tool call and counts down. Press ESC to cancel.
   */
  private countdownAllow(tool: string, args?: string): Promise<boolean> {
    const display = args !== undefined && args !== "" ? `${tool}: ${args}` : tool;
    const seconds = 2;

    return new Promise((resolve) => {
      let remaining = seconds;
      const stdin = process.stdin;

      // No TTY (tests, piped input) — skip countdown
      if (!stdin.isTTY) {
        resolve(true);
        return;
      }

      const wasRaw = stdin.isRaw ?? false;

      const showCountdown = (): void => {
        process.stdout.write(`\r\x1b[2K\x1b[33m⚡ ${display} \x1b[90m[${String(remaining)}s — ESC to cancel]\x1b[0m`);
      };

      showCountdown();

      if (stdin.isTTY) {
        stdin.setRawMode(true);
      }
      stdin.resume();

      let done = false;
      const cleanup = (result: boolean): void => {
        if (done) return;
        done = true;
        clearInterval(timer);
        stdin.removeListener("data", onKey);
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw);
        }
        if (result) {
          process.stdout.write(`\r\x1b[2K`);
        } else {
          process.stdout.write(`\r\x1b[2K\x1b[31m✖ Cancelled: ${display}\x1b[0m\n`);
        }
        resolve(result);
      };

      const onKey = (data: Buffer): void => {
        // ESC = 0x1b, Ctrl+C = 0x03
        if (data[0] === 0x1b || data[0] === 0x03) {
          cleanup(false);
        }
      };
      stdin.on("data", onKey);

      const timer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          cleanup(true);
        } else {
          showCountdown();
        }
      }, 1000);
    });
  }

  private async promptUser(
    tool: string,
    args?: string,
  ): Promise<boolean> {
    const display = args !== undefined && args !== ""
      ? `${tool}: ${args}`
      : tool;

    if (this.prompter === null) {
      // No prompter set – deny by default (safe fallback)
      return false;
    }

    const answer = await this.prompter(
      `\x1b[33m⚠ Allow ${display}? (y/N/a) \x1b[0m`,
    );
    const response = answer.trim().toLowerCase() as PermissionResponse;

    if (response === "a") {
      this.rememberedPermissions.add(tool);
      this.saveAllowedTools();
      return true;
    }
    return response === "y";
  }

  private loadAllowedTools(): void {
    try {
      if (fs.existsSync(ALLOWED_TOOLS_FILE)) {
        const data = JSON.parse(fs.readFileSync(ALLOWED_TOOLS_FILE, "utf-8")) as string[];
        for (const tool of data) {
          this.rememberedPermissions.add(tool);
        }
      }
    } catch {
      // ignore corrupt file
    }
  }

  private saveAllowedTools(): void {
    try {
      const dir = path.dirname(ALLOWED_TOOLS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        ALLOWED_TOOLS_FILE,
        JSON.stringify([...this.rememberedPermissions].sort(), null, 2) + "\n",
        "utf-8",
      );
    } catch {
      // ignore write errors
    }
  }

  resetRememberedPermissions(): void {
    this.rememberedPermissions.clear();
    this.saveAllowedTools();
  }

  getSafeTools(): string[] {
    return Object.entries(this.permissions)
      .filter(([, level]) => level === PermissionLevel.SAFE)
      .map(([name]) => name);
  }

  getDangerousTools(): string[] {
    return Object.entries(this.permissions)
      .filter(([, level]) => level === PermissionLevel.DANGEROUS)
      .map(([name]) => name);
  }

  getBlockedTools(): string[] {
    return Object.entries(this.permissions)
      .filter(([, level]) => level === PermissionLevel.BLOCKED)
      .map(([name]) => name);
  }

  getRememberedTools(): string[] {
    return [...this.rememberedPermissions].sort();
  }

  getAllPermissions(): Record<string, PermissionLevelValue> {
    return { ...this.permissions };
  }
}
