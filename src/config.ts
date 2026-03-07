import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { AppConfig, BackendConfig } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VERSION = "2.0.0";
const LOCALCODE_DIR = ".localcode";

export class Config {
  private config: AppConfig;
  private localcodeDir: string;

  constructor(configPath?: string) {
    const defaultPath =
      configPath ?? path.join(__dirname, "..", "config", "default.yaml");
    this.config = this.loadConfig(defaultPath);
    this.localcodeDir = path.join(os.homedir(), LOCALCODE_DIR);
    this.ensureLocalcodeDir();
  }

  private loadConfig(filePath: string): AppConfig {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Config file not found: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return YAML.parse(content) as AppConfig;
  }

  get<T = unknown>(dotPath: string): T | undefined {
    const parts = dotPath.split(".");
    let current: unknown = this.config;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current as T;
  }

  set(dotPath: string, value: unknown): void {
    const parts = dotPath.split(".");
    const last = parts.pop();
    if (last === undefined) return;

    let current: Record<string, unknown> = this.config as unknown as Record<string, unknown>;
    for (const part of parts) {
      if (typeof current[part] !== "object" || current[part] === null) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    current[last] = value;
  }

  getBackendConfig(): BackendConfig {
    const backend = this.config.backend;
    return this.config[backend];
  }

  getBackend(): "mlx" | "ollama" {
    return this.config.backend;
  }

  getVersion(): string {
    return VERSION;
  }

  getLocalcodeDir(): string {
    return this.localcodeDir;
  }

  getSessionsDir(): string {
    return path.join(this.localcodeDir, "sessions");
  }

  getMcpConfigPath(scope: "user"): string {
    return path.join(this.localcodeDir, "mcp.json");
  }

  private ensureLocalcodeDir(): void {
    const dirs = [this.localcodeDir, this.getSessionsDir()];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  saveLastModel(model: string): void {
    const filePath = path.join(this.localcodeDir, "last_model.txt");
    fs.writeFileSync(filePath, model.trim(), "utf-8");
  }

  loadLastModel(): string | null {
    const filePath = path.join(this.localcodeDir, "last_model.txt");
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8").trim();
    return content !== "" ? content : null;
  }

  getFullConfig(): AppConfig {
    return { ...this.config };
  }

  validate(): string[] {
    const errors: string[] = [];
    const backend = this.getBackendConfig();

    if (!backend.host) errors.push("Backend host is required");
    if (!backend.port) errors.push("Backend port is required");
    if (backend.port < 1 || backend.port > 65535) {
      errors.push("Backend port must be between 1 and 65535");
    }

    return errors;
  }

  setTestingMode(mode: "auto_yes" | "auto_no" | "simulate" | "mock"): void {
    switch (mode) {
      case "auto_yes":
        this.set("testing.auto_approve", true);
        break;
      case "auto_no":
        this.set("testing.auto_deny", true);
        break;
      case "simulate":
        this.set("testing.simulate_only", true);
        break;
      case "mock":
        this.set("testing.mock_execution", true);
        break;
    }
  }
}
