import type { LocalTool } from "../mcp/servers/local.js";
import type { MCPRegistry } from "../mcp/registry.js";
import type { MCPManager } from "../mcp/manager.js";
import type { MCPServerConfig, MCPScope } from "../types.js";

export function createMCPTools(
  registry: MCPRegistry,
  manager: MCPManager,
): LocalTool[] {
  return [
    {
      name: "mcp_add",
      description:
        "Add an MCP server. Provide name, command, and optionally args, env, scope (local/project/user). The server is started immediately and its tools become available.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Server name (e.g. 'fetch', 'filesystem')" },
          command: { type: "string", description: "Command to run (e.g. 'npx')" },
          args: { type: "string", description: "Space-separated arguments (e.g. '-y @modelcontextprotocol/server-fetch')" },
          env: { type: "string", description: "Environment variables as KEY=VALUE pairs separated by commas (e.g. 'API_KEY=abc,PORT=3000')" },
          scope: { type: "string", description: "Config scope: local (default), project, or user" },
        },
        required: ["name", "command"],
      },
      permissionLevel: "dangerous",
      handler: async (args) => {
        const name = args["name"] ?? "";
        const command = args["command"] ?? "";
        const scope = (args["scope"] ?? "local") as MCPScope;

        if (name === "" || command === "") {
          return { tool: "mcp_add", success: false, output: "name and command are required" };
        }

        const serverArgs = args["args"] ? args["args"].split(/\s+/) : [];
        const env: Record<string, string> = {};
        if (args["env"]) {
          for (const pair of args["env"].split(",")) {
            const eqIdx = pair.indexOf("=");
            if (eqIdx > 0) {
              env[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
            }
          }
        }

        const serverConfig: MCPServerConfig = { command, args: serverArgs };
        if (Object.keys(env).length > 0) serverConfig.env = env;

        // Save to registry
        registry.addServer(name, serverConfig, scope, process.cwd());

        // Start the server immediately
        try {
          await manager.startServer(name, serverConfig);
          const tools = manager.getToolsForServer(name);
          const toolNames = tools.map((t) => t.name);
          return {
            tool: "mcp_add",
            success: true,
            output: `MCP server '${name}' added (${scope}) and started. ${String(tools.length)} tools available: ${toolNames.join(", ")}`,
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            tool: "mcp_add",
            success: false,
            output: `Server '${name}' saved to config but failed to start: ${msg}`,
          };
        }
      },
    },
    {
      name: "mcp_add_json",
      description:
        "Add an MCP server using a full JSON configuration. Useful for complex configs with env vars, transport settings, etc.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Server name" },
          config: { type: "string", description: 'Full JSON config (e.g. \'{"command":"npx","args":["-y","@modelcontextprotocol/server-fetch"]}\')' },
          scope: { type: "string", description: "Config scope: local (default), project, or user" },
        },
        required: ["name", "config"],
      },
      permissionLevel: "dangerous",
      handler: async (args) => {
        const name = args["name"] ?? "";
        const configJson = args["config"] ?? "";
        const scope = (args["scope"] ?? "local") as MCPScope;

        if (name === "" || configJson === "") {
          return { tool: "mcp_add_json", success: false, output: "name and config are required" };
        }

        let serverConfig: MCPServerConfig;
        try {
          serverConfig = JSON.parse(configJson) as MCPServerConfig;
        } catch {
          return { tool: "mcp_add_json", success: false, output: "Invalid JSON config" };
        }

        registry.addServer(name, serverConfig, scope, process.cwd());

        try {
          await manager.startServer(name, serverConfig);
          const tools = manager.getToolsForServer(name);
          const toolNames = tools.map((t) => t.name);
          return {
            tool: "mcp_add_json",
            success: true,
            output: `MCP server '${name}' added (${scope}) and started. ${String(tools.length)} tools available: ${toolNames.join(", ")}`,
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            tool: "mcp_add_json",
            success: false,
            output: `Server '${name}' saved to config but failed to start: ${msg}`,
          };
        }
      },
    },
    {
      name: "mcp_remove",
      description: "Remove an MCP server by name. Stops the server and removes it from config.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Server name to remove" },
          scope: { type: "string", description: "Config scope: local (default), project, or user" },
        },
        required: ["name"],
      },
      permissionLevel: "dangerous",
      handler: async (args) => {
        const name = args["name"] ?? "";
        const scope = (args["scope"] ?? "local") as MCPScope;

        if (name === "") {
          return { tool: "mcp_remove", success: false, output: "name is required" };
        }

        // Stop the server if running
        await manager.stopServer(name);

        const removed = registry.removeServer(name, scope, process.cwd());
        if (removed) {
          return {
            tool: "mcp_remove",
            success: true,
            output: `MCP server '${name}' stopped and removed from ${scope} config`,
          };
        }
        return {
          tool: "mcp_remove",
          success: false,
          output: `Server '${name}' not found in ${scope} config`,
        };
      },
    },
    {
      name: "mcp_list",
      description: "List all configured MCP servers with their status, tools count, and connection state.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      permissionLevel: "safe",
      handler: async () => {
        const configs = registry.listServers(process.cwd());
        const status = manager.getStatus();
        const statusMap = new Map(status.map((s) => [s.name, s]));

        if (configs.length === 0 && status.length === 0) {
          return { tool: "mcp_list", success: true, output: "No MCP servers configured" };
        }

        const lines: string[] = [];
        for (const cfg of configs) {
          const srv = statusMap.get(cfg.name);
          const state = srv?.connected ? "connected" : "not running";
          const toolCount = srv?.tools.length ?? 0;
          const toolNames = srv?.tools.map((t) => t.name).join(", ") ?? "";
          lines.push(
            `${cfg.name} (${cfg.scope}): ${state}, ${String(toolCount)} tools${toolNames ? `: ${toolNames}` : ""} [${cfg.config.command} ${(cfg.config.args ?? []).join(" ")}]`,
          );
        }

        return { tool: "mcp_list", success: true, output: lines.join("\n") };
      },
    },
    {
      name: "mcp_restart",
      description: "Restart an MCP server by name. Useful if a server becomes unresponsive.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Server name to restart" },
        },
        required: ["name"],
      },
      permissionLevel: "dangerous",
      handler: async (args) => {
        const name = args["name"] ?? "";
        if (name === "") {
          return { tool: "mcp_restart", success: false, output: "name is required" };
        }

        const serverInfo = registry.getServer(name, process.cwd());
        if (serverInfo === null) {
          return { tool: "mcp_restart", success: false, output: `Server '${name}' not found in config` };
        }

        try {
          await manager.stopServer(name);
          await manager.startServer(name, serverInfo.config);
          const tools = manager.getToolsForServer(name);
          return {
            tool: "mcp_restart",
            success: true,
            output: `MCP server '${name}' restarted. ${String(tools.length)} tools available`,
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { tool: "mcp_restart", success: false, output: `Failed to restart '${name}': ${msg}` };
        }
      },
    },
  ];
}
