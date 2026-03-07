import type { MCPRegistry } from "./registry.js";
import type { MCPServerConfig, MCPScope } from "../types.js";

export interface MCPCLIArgs {
  command: string;
  name?: string;
  args?: string[];
  scope?: MCPScope;
  env?: Record<string, string>;
  transport?: "stdio" | "http" | "sse";
  json?: string;
}

export function parseMCPArgs(argv: string[]): MCPCLIArgs | null {
  if (argv.length === 0) return null;

  const command = argv[0] ?? "";
  const result: MCPCLIArgs = { command };

  switch (command) {
    case "add": {
      result.name = argv[1];
      result.scope = "user";
      result.transport = "stdio";
      result.env = {};

      const restArgs: string[] = [];
      let i = 2;
      while (i < argv.length) {
        const arg = argv[i];
        if (arg === "-s" || arg === "--scope") {
          result.scope = (argv[i + 1] ?? "local") as MCPScope;
          i += 2;
        } else if (arg === "-t" || arg === "--transport") {
          result.transport = (argv[i + 1] ?? "stdio") as "stdio" | "http" | "sse";
          i += 2;
        } else if (arg === "-e" || arg === "--env") {
          const envStr = argv[i + 1] ?? "";
          const eqIdx = envStr.indexOf("=");
          if (eqIdx > 0) {
            result.env[envStr.slice(0, eqIdx)] = envStr.slice(eqIdx + 1);
          }
          i += 2;
        } else if (arg === "--") {
          restArgs.push(...argv.slice(i + 1));
          break;
        } else if (arg !== undefined) {
          restArgs.push(arg);
          i++;
        }
      }
      result.args = restArgs;
      return result;
    }

    case "add-json": {
      result.name = argv[1];
      result.json = argv[2];
      result.scope = "user";

      for (let i = 3; i < argv.length; i++) {
        const arg = argv[i];
        if ((arg === "-s" || arg === "--scope") && argv[i + 1] !== undefined) {
          result.scope = argv[i + 1] as MCPScope;
          i++;
        }
      }
      return result;
    }

    case "remove": {
      result.name = argv[1];
      result.scope = "user";

      for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if ((arg === "-s" || arg === "--scope") && argv[i + 1] !== undefined) {
          result.scope = argv[i + 1] as MCPScope;
          i++;
        }
      }
      return result;
    }

    case "list":
    case "get":
    case "status":
      result.name = argv[1];
      return result;

    default:
      return result;
  }
}

export function executeMCPCommand(
  registry: MCPRegistry,
  parsed: MCPCLIArgs,
  cwd: string,
): void {
  switch (parsed.command) {
    case "add": {
      if (parsed.name === undefined || parsed.args === undefined || parsed.args.length === 0) {
        console.error("Usage: localcode mcp add <name> <command> [args...]");
        process.exit(1);
      }

      const commandStr = parsed.args[0] ?? "";
      const serverConfig: MCPServerConfig = {
        command: commandStr,
        args: parsed.args.slice(1),
        transport: parsed.transport,
      };

      if (parsed.env !== undefined && Object.keys(parsed.env).length > 0) {
        serverConfig.env = parsed.env;
      }

      if (parsed.transport === "http" || parsed.transport === "sse") {
        serverConfig.url = commandStr;
      }

      registry.addServer(
        parsed.name,
        serverConfig,
        parsed.scope ?? "local",
        cwd,
      );
      console.log(`Added MCP server '${parsed.name}' (${parsed.scope ?? "local"})`);
      break;
    }

    case "add-json": {
      if (parsed.name === undefined || parsed.json === undefined) {
        console.error("Usage: localcode mcp add-json <name> '<json>'");
        process.exit(1);
      }

      try {
        const serverConfig = JSON.parse(parsed.json) as MCPServerConfig;
        registry.addServer(
          parsed.name,
          serverConfig,
          parsed.scope ?? "local",
          cwd,
        );
        console.log(`Added MCP server '${parsed.name}' (${parsed.scope ?? "local"})`);
      } catch {
        console.error("Invalid JSON configuration");
        process.exit(1);
      }
      break;
    }

    case "remove": {
      if (parsed.name === undefined) {
        console.error("Usage: localcode mcp remove <name>");
        process.exit(1);
      }

      const removed = registry.removeServer(
        parsed.name,
        parsed.scope ?? "local",
        cwd,
      );
      if (removed) {
        console.log(`Removed MCP server '${parsed.name}'`);
      } else {
        console.error(`Server '${parsed.name}' not found`);
        process.exit(1);
      }
      break;
    }

    case "list": {
      const servers = registry.listServers(cwd);
      if (servers.length === 0) {
        console.log("No MCP servers configured");
        return;
      }
      for (const s of servers) {
        const transport = s.config.transport ?? "stdio";
        console.log(`  ${s.name} (${s.scope}, ${transport}): ${s.config.command} ${(s.config.args ?? []).join(" ")}`);
      }
      break;
    }

    case "get": {
      if (parsed.name === undefined) {
        console.error("Usage: localcode mcp get <name>");
        process.exit(1);
      }

      const result = registry.getServer(parsed.name, cwd);
      if (result === null) {
        console.error(`Server '${parsed.name}' not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "status":
      console.log("Use the /mcp command inside the REPL for live status");
      break;

    default:
      console.error(`Unknown MCP command: ${parsed.command}`);
      console.error("Commands: add, add-json, remove, list, get, status");
      process.exit(1);
  }
}
