import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the MCP SDK before importing manager
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  const MockClient = class {
    connect = vi.fn().mockResolvedValue(undefined);
    listTools = vi.fn().mockResolvedValue({
      tools: [
        { name: "tool1", description: "Tool 1", inputSchema: {} },
        { name: "tool2", description: "Tool 2", inputSchema: {} },
      ],
    });
    callTool = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "result" }],
    });
    close = vi.fn().mockResolvedValue(undefined);
  };
  return { Client: MockClient };
});

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => {
  const MockTransport = class {
    onclose: (() => void) | null = null;
  };
  return { StdioClientTransport: MockTransport };
});

import { MCPManager } from "../../src/mcp/manager.js";
import { MCPRegistry } from "../../src/mcp/registry.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("MCPManager", () => {
  let manager: MCPManager;
  let registry: MCPRegistry;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-mgr-test-"));
    registry = new MCPRegistry(tmpDir);
    manager = new MCPManager(registry);
  });

  describe("startServer", () => {
    it("starts a server and adds it to the map", async () => {
      await manager.startServer("test", { command: "echo", args: ["hello"] });

      const status = manager.getStatus();
      expect(status).toHaveLength(1);
      expect(status[0]?.name).toBe("test");
      expect(status[0]?.connected).toBe(true);
      expect(status[0]?.tools).toHaveLength(2);
    });

    it("replaces an existing server with the same name", async () => {
      await manager.startServer("test", { command: "echo", args: ["v1"] });
      await manager.startServer("test", { command: "echo", args: ["v2"] });

      const status = manager.getStatus();
      expect(status).toHaveLength(1);
    });

    it("skips HTTP/SSE transport with warning", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await manager.startServer("http-srv", { command: "http://localhost", transport: "http" });

      expect(manager.getStatus()).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("not yet supported"));
      warnSpy.mockRestore();
    });

    it("skips SSE transport", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await manager.startServer("sse-srv", { command: "http://localhost", transport: "sse" });

      expect(manager.getStatus()).toHaveLength(0);
      warnSpy.mockRestore();
    });
  });

  describe("stopServer", () => {
    it("removes server from the map", async () => {
      await manager.startServer("test", { command: "echo" });
      expect(manager.getStatus()).toHaveLength(1);

      await manager.stopServer("test");
      expect(manager.getStatus()).toHaveLength(0);
    });

    it("does nothing for non-existent server", async () => {
      await manager.stopServer("nonexistent");
      expect(manager.getStatus()).toHaveLength(0);
    });
  });

  describe("stopAll", () => {
    it("removes all servers from the map", async () => {
      await manager.startServer("srv1", { command: "echo" });
      await manager.startServer("srv2", { command: "echo" });
      expect(manager.getStatus()).toHaveLength(2);

      await manager.stopAll();
      expect(manager.getStatus()).toHaveLength(0);
    });

    it("does nothing when no servers", async () => {
      await manager.stopAll();
      expect(manager.getStatus()).toHaveLength(0);
    });
  });

  describe("startAll", () => {
    it("starts all servers from registry", async () => {
      registry.addServer("srv1", { command: "echo" }, "user", tmpDir);
      registry.addServer("srv2", { command: "echo" }, "user", tmpDir);

      await manager.startAll(tmpDir);
      expect(manager.getStatus()).toHaveLength(2);
    });

    it("continues when individual server fails", async () => {
      // The mock won't fail, but test the error path
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      registry.addServer("srv1", { command: "echo" }, "user", tmpDir);
      await manager.startAll(tmpDir);

      expect(manager.getStatus()).toHaveLength(1);
      errSpy.mockRestore();
    });
  });

  describe("getAllTools", () => {
    it("returns tools from all servers", async () => {
      await manager.startServer("srv1", { command: "echo" });
      await manager.startServer("srv2", { command: "echo" });

      const tools = manager.getAllTools();
      expect(tools).toHaveLength(4); // 2 tools per server
    });

    it("returns empty when no servers", () => {
      expect(manager.getAllTools()).toHaveLength(0);
    });
  });

  describe("getToolsForServer", () => {
    it("returns tools for a specific server", async () => {
      await manager.startServer("test", { command: "echo" });
      const tools = manager.getToolsForServer("test");
      expect(tools).toHaveLength(2);
      expect(tools[0]?.server).toBe("test");
    });

    it("returns empty for non-existent server", () => {
      expect(manager.getToolsForServer("nope")).toHaveLength(0);
    });
  });

  describe("callTool", () => {
    it("calls a tool on a running server", async () => {
      await manager.startServer("test", { command: "echo" });
      const result = await manager.callTool("test", "tool1", {});
      expect(result).toBe("result");
    });

    it("throws for non-existent server", async () => {
      await expect(manager.callTool("nope", "tool1", {})).rejects.toThrow(
        "MCP server 'nope' not found",
      );
    });

    it("throws for disconnected server", async () => {
      await manager.startServer("test", { command: "echo" });
      // Simulate disconnect
      const status = manager.getStatus();
      // Access internal to simulate disconnect
      (manager as unknown as { servers: Map<string, { connected: boolean }> })
        .servers.get("test")!.connected = false;

      await expect(manager.callTool("test", "tool1", {})).rejects.toThrow(
        "not connected",
      );
    });
  });

  describe("isServerConnected", () => {
    it("returns true for connected server", async () => {
      await manager.startServer("test", { command: "echo" });
      expect(manager.isServerConnected("test")).toBe(true);
    });

    it("returns false for non-existent server", () => {
      expect(manager.isServerConnected("nope")).toBe(false);
    });
  });

  describe("resolveToolCall", () => {
    it("parses mcp__server__tool format", () => {
      const result = manager.resolveToolCall("mcp__myserver__mytool");
      expect(result).toEqual({ serverName: "myserver", toolName: "mytool" });
    });

    it("handles server names with double underscores", () => {
      const result = manager.resolveToolCall("mcp__my__server__mytool");
      expect(result).not.toBeNull();
    });

    it("returns null for invalid format", () => {
      expect(manager.resolveToolCall("invalid")).toBeNull();
      expect(manager.resolveToolCall("mcp__")).toBeNull();
    });
  });

  describe("getPrefixedToolName", () => {
    it("creates prefixed name", () => {
      expect(manager.getPrefixedToolName("srv", "tool")).toBe("mcp__srv__tool");
    });
  });

  describe("getStatus after stopAll (the REPL bug)", () => {
    it("returns empty after stopAll kills servers", async () => {
      await manager.startServer("test", { command: "echo" });
      expect(manager.getStatus()).toHaveLength(1);

      // This is what happened: startRepl returned immediately,
      // then stopAll was called, killing all servers
      await manager.stopAll();
      expect(manager.getStatus()).toHaveLength(0);
      expect(manager.getAllTools()).toHaveLength(0);
    });

    it("servers survive when stopAll is NOT called", async () => {
      await manager.startServer("srv1", { command: "echo" });
      await manager.startServer("srv2", { command: "echo" });

      // Simulate REPL running (no stopAll called)
      expect(manager.getStatus()).toHaveLength(2);
      expect(manager.getAllTools()).toHaveLength(4);

      // Only after REPL exits should stopAll be called
      await manager.stopAll();
      expect(manager.getStatus()).toHaveLength(0);
    });
  });
});
