#!/usr/bin/env node

import { Command } from "commander";
import { Config } from "./config.js";
import { Client } from "./client.js";
import { Permissions } from "./permissions.js";
import { Session } from "./session.js";
import { MCPRegistry } from "./mcp/registry.js";
import { MCPManager } from "./mcp/manager.js";
import { UI } from "./ui.js";
import { parseMCPArgs, executeMCPCommand } from "./mcp/cli.js";

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("localcode")
    .description("AI coding agent for local LLMs")
    .version("2.0.0")
    .option("--backend <backend>", "Backend to use (mlx or ollama)")
    .option("--model <model>", "Model to use")
    .option("--auto-yes", "Auto-approve all permissions")
    .option("--auto-no", "Auto-deny all permissions")
    .option("--simulate", "Simulate mode")
    .option("--test-mode", "Test mode")
    .option(
      "--dangerously-skip-permissions",
      "Skip ALL permission checks (for CI/CD)",
    )
    .argument("[prompt]", "One-shot prompt (non-interactive)")
    .action(async (prompt: string | undefined, opts: Record<string, unknown>) => {
      const config = new Config();

      // Apply backend override
      if (typeof opts["backend"] === "string") {
        config.set("backend", opts["backend"]);
      }

      // Initialize components
      const backendConfig = config.getBackendConfig();
      const client = new Client(config.getBackend(), backendConfig);
      const permissions = new Permissions(
        config.get("permissions") as import("./types.js").PermissionsConfig | undefined,
      );
      const session = new Session(config.getSessionsDir());
      const registry = new MCPRegistry(config.getLocalcodeDir());
      const mcpManager = new MCPManager(registry);

      // Apply permission flags
      if (opts["dangerouslySkipPermissions"] === true) {
        permissions.setDangerouslySkipPermissions(true);
        console.warn(
          "\x1b[31m⚠ All permission checks disabled – tools execute without confirmation\x1b[0m",
        );
      }
      if (opts["autoYes"] === true) {
        permissions.setTestingMode("auto_yes");
      }
      if (opts["autoNo"] === true) {
        permissions.setTestingMode("auto_no");
      }

      // Apply model override
      if (typeof opts["model"] === "string") {
        const modelName = opts["model"];
        // Will be applied after connect
        config.saveLastModel(modelName);
      }

      // Connect to backend (auto-start MLX if needed)
      process.stdout.write("Connecting to backend...\r");
      let connected = await client.connect();
      process.stdout.write("\x1b[2K");

      if (!connected && config.getBackend() === "mlx") {
        const { startMLXServer } = await import("./mlx.js");
        const started = await startMLXServer(backendConfig.port);
        if (started) {
          connected = await client.connect();
        }
      }

      if (!connected) {
        const bc = config.getBackendConfig();
        console.error(
          `\x1b[31mCannot connect to ${config.getBackend()} at ${bc.host}:${String(bc.port)}\x1b[0m`,
        );
        console.error("Make sure the backend is running.");
        process.exit(1);
      }

      // Restore last model
      const lastModel = config.loadLastModel();
      if (lastModel !== null) {
        client.setModel(lastModel);
      }

      // Start MCP servers
      try {
        await mcpManager.startAll(process.cwd());
      } catch {
        // MCP failures are non-fatal
      }

      const ui = new UI(client, session, permissions, config, mcpManager, registry);

      if (prompt !== undefined && prompt !== "") {
        // One-shot mode
        await ui.processInput(prompt);
        await mcpManager.stopAll();
      } else {
        // Interactive REPL
        await ui.startRepl();
        await mcpManager.stopAll();
      }
    });

  // MCP subcommand
  program
    .command("mcp")
    .description("Manage MCP servers")
    .allowUnknownOption()
    .allowExcessArguments()
    .action((_opts: unknown, cmd: Command) => {
      const config = new Config();
      const registry = new MCPRegistry(config.getLocalcodeDir());
      const args = cmd.args;
      const parsed = parseMCPArgs(args);

      if (parsed === null) {
        console.error("Usage: localcode mcp <add|remove|list|get>");
        process.exit(1);
      }

      executeMCPCommand(registry, parsed, process.cwd());
    });

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Fatal: ${msg}`);
  process.exit(1);
});
