import {
  PermissionLevel,
  type PermissionLevelValue,
  type PermissionsConfig,
  type TestingMode,
  type PermissionResponse,
} from "./types.js";

export type PermissionPrompter = (message: string) => Promise<string>;

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
      return true;
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
      return true;
    }
    return response === "y";
  }

  resetRememberedPermissions(): void {
    this.rememberedPermissions.clear();
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

  getAllPermissions(): Record<string, PermissionLevelValue> {
    return { ...this.permissions };
  }
}
