import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MCPRegistry } from "../../src/mcp/registry.js";

describe("MCPRegistry", () => {
  let registry: MCPRegistry;
  let tempDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localcode-mcp-"));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "localcode-proj-"));
    registry = new MCPRegistry(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  describe("addServer", () => {
    it("should add a server to user scope", () => {
      registry.addServer(
        "test-server",
        { command: "npx", args: ["-y", "test-mcp"] },
        "user",
        projectDir,
      );

      const configPath = path.join(tempDir, "mcp.json");
      expect(fs.existsSync(configPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(content.mcpServers["test-server"]).toBeDefined();
      expect(content.mcpServers["test-server"].command).toBe("npx");
    });

    it("should add a server to project scope", () => {
      registry.addServer(
        "github",
        { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
        "project",
        projectDir,
      );

      const configPath = path.join(projectDir, ".mcp.json");
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it("should add server with env vars", () => {
      registry.addServer(
        "github",
        {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "abc123" },
        },
        "user",
        projectDir,
      );

      const server = registry.getServer("github", projectDir);
      expect(server?.config.env?.GITHUB_TOKEN).toBe("abc123");
    });
  });

  describe("removeServer", () => {
    it("should remove an existing server", () => {
      registry.addServer("to-remove", { command: "test" }, "user", projectDir);
      expect(registry.removeServer("to-remove", "user", projectDir)).toBe(true);
      expect(registry.getServer("to-remove", projectDir)).toBeNull();
    });

    it("should return false for nonexistent server", () => {
      expect(registry.removeServer("ghost", "user", projectDir)).toBe(false);
    });
  });

  describe("getServer", () => {
    it("should find server across scopes", () => {
      registry.addServer("my-server", { command: "cmd" }, "user", projectDir);
      const result = registry.getServer("my-server", projectDir);
      expect(result).not.toBeNull();
      expect(result?.scope).toBe("user");
    });

    it("should prefer local over project over user", () => {
      registry.addServer("multi", { command: "user-cmd" }, "user", projectDir);
      registry.addServer("multi", { command: "project-cmd" }, "project", projectDir);

      const result = registry.getServer("multi", projectDir);
      expect(result?.config.command).toBe("project-cmd");
      expect(result?.scope).toBe("project");
    });

    it("should return null for unknown server", () => {
      expect(registry.getServer("nope", projectDir)).toBeNull();
    });
  });

  describe("listServers", () => {
    it("should list all servers sorted", () => {
      registry.addServer("beta", { command: "b" }, "user", projectDir);
      registry.addServer("alpha", { command: "a" }, "project", projectDir);

      const list = registry.listServers(projectDir);
      expect(list).toHaveLength(2);
      expect(list[0]?.name).toBe("alpha");
      expect(list[1]?.name).toBe("beta");
    });

    it("should deduplicate across scopes", () => {
      registry.addServer("dup", { command: "a" }, "user", projectDir);
      registry.addServer("dup", { command: "b" }, "project", projectDir);

      const list = registry.listServers(projectDir);
      expect(list).toHaveLength(1);
      // local checked first, then project, then user
      expect(list[0]?.config.command).toBe("b");
    });

    it("should return empty for no servers", () => {
      expect(registry.listServers(projectDir)).toHaveLength(0);
    });
  });
});
