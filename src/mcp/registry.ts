import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { MCPConfigFile, MCPScope, MCPServerConfig } from "../types.js";

const EMPTY_CONFIG: MCPConfigFile = { mcpServers: {} };

export class MCPRegistry {
  private localcodeDir: string;

  constructor(localcodeDir: string) {
    this.localcodeDir = localcodeDir;
  }

  private getConfigPath(scope: MCPScope, cwd: string): string {
    switch (scope) {
      case "user":
        return path.join(this.localcodeDir, "mcp.json");
      case "project":
        return path.join(cwd, ".mcp.json");
      case "local":
        return path.join(cwd, ".claude", "settings.local.json");
    }
  }

  private readConfig(filePath: string): MCPConfigFile {
    if (!fs.existsSync(filePath)) return { ...EMPTY_CONFIG, mcpServers: {} };

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content) as Partial<MCPConfigFile>;
      return {
        mcpServers: parsed.mcpServers ?? {},
      };
    } catch {
      return { ...EMPTY_CONFIG, mcpServers: {} };
    }
  }

  private writeConfig(filePath: string, config: MCPConfigFile): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
  }

  addServer(
    name: string,
    serverConfig: MCPServerConfig,
    scope: MCPScope,
    cwd: string,
  ): void {
    const configPath = this.getConfigPath(scope, cwd);
    const config = this.readConfig(configPath);
    config.mcpServers[name] = serverConfig;
    this.writeConfig(configPath, config);
  }

  removeServer(name: string, scope: MCPScope, cwd: string): boolean {
    const configPath = this.getConfigPath(scope, cwd);
    const config = this.readConfig(configPath);

    if (!(name in config.mcpServers)) return false;

    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete config.mcpServers[name];
    this.writeConfig(configPath, config);
    return true;
  }

  getServer(
    name: string,
    cwd: string,
  ): { config: MCPServerConfig; scope: MCPScope } | null {
    const scopes: MCPScope[] = ["local", "project", "user"];

    for (const scope of scopes) {
      const configPath = this.getConfigPath(scope, cwd);
      const config = this.readConfig(configPath);
      const server = config.mcpServers[name];
      if (server !== undefined) {
        return { config: server, scope };
      }
    }

    return null;
  }

  listServers(cwd: string): Array<{
    name: string;
    config: MCPServerConfig;
    scope: MCPScope;
  }> {
    const result: Array<{
      name: string;
      config: MCPServerConfig;
      scope: MCPScope;
    }> = [];
    const seen = new Set<string>();
    const scopes: MCPScope[] = ["local", "project", "user"];

    for (const scope of scopes) {
      const configPath = this.getConfigPath(scope, cwd);
      const config = this.readConfig(configPath);

      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        if (!seen.has(name)) {
          seen.add(name);
          result.push({ name, config: serverConfig, scope });
        }
      }
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  importFromClaudeDesktop(): number {
    const configPath = path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );

    if (!fs.existsSync(configPath)) return 0;

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(content) as MCPConfigFile;
      let count = 0;

      for (const [name, serverConfig] of Object.entries(
        config.mcpServers ?? {},
      )) {
        this.addServer(name, serverConfig, "user", process.cwd());
        count++;
      }

      return count;
    } catch {
      return 0;
    }
  }
}
