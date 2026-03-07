import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { MCPServerConfig, MCPServerStatus, MCPToolInfo } from "../types.js";
import { MCPRegistry } from "./registry.js";

interface ActiveServer {
  name: string;
  config: MCPServerConfig;
  client: MCPClient;
  transport: StdioClientTransport;
  tools: MCPToolInfo[];
  connected: boolean;
}

export class MCPManager {
  private registry: MCPRegistry;
  private servers: Map<string, ActiveServer> = new Map();

  constructor(registry: MCPRegistry) {
    this.registry = registry;
  }

  async startAll(cwd: string): Promise<void> {
    const configs = this.registry.listServers(cwd);
    const startPromises = configs.map((s) =>
      this.startServer(s.name, s.config).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to start MCP server '${s.name}': ${msg}`);
      }),
    );
    await Promise.all(startPromises);
  }

  async startServer(name: string, config: MCPServerConfig): Promise<void> {
    if (this.servers.has(name)) {
      await this.stopServer(name);
    }

    if (config.transport === "http" || config.transport === "sse") {
      // HTTP/SSE transport - not yet implemented
      console.warn(`HTTP/SSE transport for '${name}' not yet supported`);
      return;
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env as Record<string, string> | undefined,
    });

    const client = new MCPClient({
      name: `localcode-${name}`,
      version: "2.0.0",
    });

    await client.connect(transport);

    const toolsResult = await client.listTools();
    const tools: MCPToolInfo[] = toolsResult.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema as Record<string, unknown>,
      server: name,
    }));

    this.servers.set(name, {
      name,
      config,
      client,
      transport,
      tools,
      connected: true,
    });

    // Track disconnections
    transport.onclose = () => {
      const srv = this.servers.get(name);
      if (srv !== undefined) {
        srv.connected = false;
      }
    };
  }

  async stopServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (server === undefined) return;

    try {
      await server.client.close();
    } catch {
      // ignore close errors
    }

    this.servers.delete(name);
  }

  async stopAll(): Promise<void> {
    const names = [...this.servers.keys()];
    await Promise.all(names.map((n) => this.stopServer(n)));
  }

  async restartServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (server === undefined) return;

    await this.stopServer(name);
    await this.startServer(name, server.config);
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const server = this.servers.get(serverName);
    if (server === undefined) {
      throw new Error(`MCP server '${serverName}' not found`);
    }

    if (!server.connected) {
      throw new Error(`MCP server '${serverName}' not connected`);
    }

    const result = await server.client.callTool({
      name: toolName,
      arguments: args,
    });

    const content = result.content;
    if (Array.isArray(content)) {
      return content
        .map((c) => {
          if (typeof c === "object" && c !== null && "text" in c) {
            return String(c.text);
          }
          return JSON.stringify(c);
        })
        .join("\n");
    }

    return JSON.stringify(content);
  }

  getAllTools(): MCPToolInfo[] {
    const tools: MCPToolInfo[] = [];
    for (const server of this.servers.values()) {
      tools.push(...server.tools);
    }
    return tools;
  }

  getToolsForServer(name: string): MCPToolInfo[] {
    return this.servers.get(name)?.tools ?? [];
  }

  getStatus(): MCPServerStatus[] {
    return [...this.servers.values()].map((s) => ({
      name: s.name,
      config: s.config,
      connected: s.connected,
      tools: s.tools,
    }));
  }

  isServerConnected(name: string): boolean {
    return this.servers.get(name)?.connected ?? false;
  }

  resolveToolCall(prefixedName: string): {
    serverName: string;
    toolName: string;
  } | null {
    // Format: mcp__servername__toolname
    const match = /^mcp__([^_]+(?:__[^_]+)*)__([^_].*)$/.exec(prefixedName);
    if (match === null) return null;

    const serverName = match[1];
    const toolName = match[2];
    if (serverName === undefined || toolName === undefined) return null;

    return { serverName, toolName };
  }

  getPrefixedToolName(serverName: string, toolName: string): string {
    return `mcp__${serverName}__${toolName}`;
  }
}
