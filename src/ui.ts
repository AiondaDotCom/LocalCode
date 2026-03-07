import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Client } from "./client.js";
import type { Session } from "./session.js";
import type { Permissions } from "./permissions.js";
import type { Config } from "./config.js";
import type { MCPManager } from "./mcp/manager.js";
import type { ToolCall, ToolResult, MCPToolInfo } from "./types.js";
import {
  getLocalTools,
  getLocalToolPermission,
  executeLocalTool,
} from "./mcp/servers/local.js";
import { loadContextFiles, buildContextPrompt } from "./context.js";

export class UI {
  private client: Client;
  private session: Session;
  private permissions: Permissions;
  private config: Config;
  private mcpManager: MCPManager;
  private rl: readline.Interface | null = null;
  private running = false;

  constructor(
    client: Client,
    session: Session,
    permissions: Permissions,
    config: Config,
    mcpManager: MCPManager,
  ) {
    this.client = client;
    this.session = session;
    this.permissions = permissions;
    this.config = config;
    this.mcpManager = mcpManager;
  }

  buildSystemPrompt(): string {
    const contextFiles = loadContextFiles(process.cwd());
    const contextPrompt = buildContextPrompt(contextFiles);
    const cwd = process.cwd();

    return [
      "You are LocalCode, an AI coding agent. You help with software engineering tasks.",
      "",
      `Working directory: ${cwd}`,
      "",
      "IMPORTANT: You have tools available. ALWAYS use them to complete tasks:",
      "- To create or write files: use the `write` tool with file_path and content",
      "- To edit existing files: use the `edit` tool with file_path, old_text, new_text",
      "- To read files: use the `read` tool with file_path",
      "- To run commands: use the `bash` tool with command",
      "- To search files: use `grep` (content) or `glob` (filenames)",
      "- To list directories: use the `list` tool",
      "",
      "When the user asks you to create a program, ALWAYS use the write tool to save it as a file.",
      "When the user asks you to run something, ALWAYS use the bash tool.",
      "Do NOT just output code as text — use tools to actually perform the work.",
      "",
      contextPrompt,
    ].join("\n");
  }

  buildToolsArray(): Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    const localTools = getLocalTools();
    const mcpTools = this.mcpManager.getAllTools();

    return [
      ...localTools.map((t) => ({
        type: "function" as const,
        function: {
          name: `mcp__local__${t.name}`,
          description: t.description,
          parameters: t.inputSchema,
        },
      })),
      ...mcpTools.map((t) => ({
        type: "function" as const,
        function: {
          name: `mcp__${t.server}__${t.name}`,
          description: t.description,
          parameters: t.inputSchema,
        },
      })),
    ];
  }

  parseToolCalls(response: string): ToolCall[] {
    const calls: ToolCall[] = [];
    const regex =
      /\[TOOL_CALL\]\s*(?:name:\s*)?([\w_]+)\s*(?:arguments:\s*)?([\s\S]*?)\s*\[\/TOOL_CALL\]/g;

    let match;
    while ((match = regex.exec(response)) !== null) {
      const name = match[1]?.trim() ?? "";
      const argsStr = match[2]?.trim() ?? "{}";

      try {
        const args = JSON.parse(argsStr) as Record<string, string>;
        calls.push({ name, arguments: args });
      } catch {
        calls.push({ name, arguments: {} });
      }
    }

    return calls;
  }

  async executeTool(call: ToolCall): Promise<ToolResult> {
    const resolved = this.mcpManager.resolveToolCall(call.name);

    if (resolved !== null && resolved.serverName !== "local") {
      // External MCP tool
      const allowed = await this.permissions.requestPermission(
        "shell_exec",
        `MCP: ${call.name}`,
      );
      if (!allowed) {
        return {
          tool: call.name,
          success: false,
          output: "Permission denied",
        };
      }

      try {
        const output = await this.mcpManager.callTool(
          resolved.serverName,
          resolved.toolName,
          call.arguments,
        );
        return { tool: call.name, success: true, output };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { tool: call.name, success: false, output: msg };
      }
    }

    // Local tool
    const toolName = resolved?.toolName ?? call.name;
    const permission = getLocalToolPermission(toolName);

    if (permission === "dangerous") {
      const permissionKey = toolName === "bash" || toolName === "task"
        ? "shell_exec"
        : toolName === "write" || toolName === "edit"
          ? "file_write"
          : "shell_exec";
      const allowed = await this.permissions.requestPermission(
        permissionKey,
        `${toolName}: ${JSON.stringify(call.arguments)}`,
      );
      if (!allowed) {
        return {
          tool: toolName,
          success: false,
          output: "Permission denied",
        };
      }
    }

    return executeLocalTool(toolName, call.arguments);
  }

  formatToolResults(results: ToolResult[]): string {
    return results
      .map(
        (r) =>
          `[${r.success ? "OK" : "ERR"}] ${r.tool}: ${r.output}`,
      )
      .join("\n\n");
  }

  async handleSlashCommand(input: string): Promise<boolean> {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0];
    const arg = parts.slice(1).join(" ");

    switch (cmd) {
      case "/help":
        this.showHelp();
        return true;

      case "/version":
        console.log(`LocalCode v${this.config.getVersion()}`);
        return true;

      case "/models":
        this.showModels();
        return true;

      case "/model":
        if (arg !== "") {
          if (this.client.setModel(arg)) {
            this.config.saveLastModel(arg);
            console.log(`Switched to model: ${arg}`);
          } else {
            console.log(`Model not found: ${arg}`);
          }
        } else {
          console.log(`Current: ${this.client.getCurrentModel() ?? "none"}`);
          this.showModels();
        }
        return true;

      case "/current":
        console.log(this.client.getCurrentModel() ?? "No model selected");
        return true;

      case "/tools":
        this.showTools();
        return true;

      case "/permissions":
        this.showPermissions();
        return true;

      case "/mcp":
        this.showMCPStatus();
        return true;

      case "/save":
        if (arg !== "") {
          this.session.saveSession(arg);
          console.log(`Session saved: ${arg}`);
        } else {
          console.log("Usage: /save <name>");
        }
        return true;

      case "/load":
        if (arg !== "" && this.session.loadSession(arg)) {
          console.log(`Session loaded: ${arg}`);
        } else {
          console.log(arg !== "" ? `Session not found: ${arg}` : "Usage: /load <name>");
        }
        return true;

      case "/sessions":
        const sessions = this.session.listSessions();
        console.log(
          sessions.length > 0 ? sessions.join("\n") : "No saved sessions",
        );
        return true;

      case "/clear":
        this.session.clearSession();
        console.log("Session cleared");
        return true;

      case "/pwd":
        console.log(process.cwd());
        return true;

      case "/cd": {
        const target = arg !== "" ? arg.replace(/^~/, process.env["HOME"] ?? "") : (process.env["HOME"] ?? "");
        try {
          process.chdir(target);
          console.log(process.cwd());
        } catch {
          console.log(`Cannot cd to: ${target}`);
        }
        return true;
      }

      case "/exit":
      case "/quit":
        this.running = false;
        return true;

      default:
        return false;
    }
  }

  private showHelp(): void {
    console.log(`
LocalCode v${this.config.getVersion()} - Commands:

  /model [name]    Switch model or show current
  /models          List available models
  /current         Show current model
  /tools           List available tools
  /permissions     Show permission settings
  /mcp             Show MCP server status
  /save <name>     Save session
  /load <name>     Load session
  /sessions        List saved sessions
  /clear           Clear session
  /pwd             Show working directory
  /cd [path]       Change directory
  /version         Show version
  /help            Show this help
  /exit            Exit
`.trim());
  }

  private showModels(): void {
    const models = this.client.listModels();
    const current = this.client.getCurrentModel();
    if (models.length === 0) {
      console.log("No models available");
      return;
    }
    for (const m of models) {
      const marker = m === current ? " ← current" : "";
      console.log(`  ${m}${marker}`);
    }
  }

  private showTools(): void {
    const localTools = getLocalTools();
    const mcpTools = this.mcpManager.getAllTools();

    console.log("\nBuilt-in tools:");
    for (const t of localTools) {
      const perm = getLocalToolPermission(t.name) ?? "safe";
      const badge = perm === "dangerous" ? " [DANGEROUS]" : "";
      console.log(`  mcp__local__${t.name}${badge} - ${t.description}`);
    }

    if (mcpTools.length > 0) {
      console.log("\nMCP tools:");
      for (const t of mcpTools) {
        console.log(`  mcp__${t.server}__${t.name} - ${t.description}`);
      }
    }
  }

  private showPermissions(): void {
    console.log("\nSafe (auto-allow):");
    for (const t of this.permissions.getSafeTools()) {
      console.log(`  ${t}`);
    }
    console.log("\nDangerous (requires confirmation):");
    for (const t of this.permissions.getDangerousTools()) {
      console.log(`  ${t}`);
    }
    const blocked = this.permissions.getBlockedTools();
    if (blocked.length > 0) {
      console.log("\nBlocked:");
      for (const t of blocked) {
        console.log(`  ${t}`);
      }
    }
  }

  private showMCPStatus(): void {
    const servers = this.mcpManager.getStatus();
    if (servers.length === 0) {
      console.log("No MCP servers configured");
      return;
    }
    for (const s of servers) {
      const status = s.connected ? "\x1b[32mconnected\x1b[0m" : "\x1b[31mdisconnected\x1b[0m";
      console.log(`  ${s.name}: ${status} (${String(s.tools.length)} tools)`);
    }
  }

  private getPrompt(): string {
    const stats = this.client.getContextStats();
    const model = this.client.getCurrentModel() ?? "no model";
    const pct = stats.percentage > 0 ? ` ${String(stats.percentage)}%` : "";
    return `\x1b[36m${model}${pct}\x1b[0m> `;
  }

  async processInput(input: string): Promise<void> {
    if (input.startsWith("/")) {
      const handled = await this.handleSlashCommand(input);
      if (handled) return;
    }

    this.session.addMessage("user", input);

    const systemPrompt = this.buildSystemPrompt();
    const messages = this.session.getMessagesForChat(systemPrompt);
    const tools = this.buildToolsArray();

    try {
      const onToken = (token: string): void => {
        process.stdout.write(token);
      };
      const response = await this.client.chat(messages, undefined, tools, onToken);
      const content = response.message.content;
      const toolCalls = response.message.tool_calls ?? this.parseToolCalls(content);

      if (toolCalls.length > 0) {
        // Tool calls detected — content was already streamed
        if (content.trim() !== "") {
          process.stdout.write("\n");
        }

        const results: ToolResult[] = [];
        for (const call of toolCalls) {
          const result = await this.executeTool(call);
          results.push(result);
        }

        const resultText = this.formatToolResults(results);
        console.log(`\n${resultText}`);

        this.session.addMessage("assistant", content);
        this.session.addMessage("tool", resultText);

        // Send results back to LLM for summary (no tools — prevent duplicate calls)
        const followupMessages = this.session.getMessagesForChat(systemPrompt);
        const followup = await this.client.chat(followupMessages, undefined, undefined, onToken);
        const followupContent = followup.message.content;
        process.stdout.write("\n");
        this.session.addMessage("assistant", followupContent);
      } else {
        // Pure text response — already streamed
        process.stdout.write("\n");
        this.session.addMessage("assistant", content);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      console.error(`\x1b[31mError: ${msg}\x1b[0m`);
    }
  }

  async startRepl(): Promise<void> {
    this.running = true;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      completer: (line: string) => this.completer(line),
    });
    this.rl = rl;

    // Load history
    const historyFile = path.join(
      this.config.getLocalcodeDir(),
      "command_history",
    );
    if (fs.existsSync(historyFile)) {
      const lines = fs.readFileSync(historyFile, "utf-8").split("\n").filter(Boolean);
      for (const line of lines.slice(-100)) {
        (rl as unknown as { history: string[] }).history?.unshift(line);
      }
    }

    // Inject permission prompter that uses the REPL readline
    this.permissions.setPrompter((message: string) => {
      return new Promise((resolve) => {
        rl.question(message, (answer) => {
          resolve(answer);
        });
      });
    });

    const backend = this.client.getBackend().toUpperCase();
    const model = this.client.getCurrentModel() ?? "no model";
    console.log(`
\x1b[36m  _                    _  ____          _
 | |    ___   ___ __ _| |/ ___|___   __| | ___
 | |   / _ \\ / __/ _\` | | |   / _ \\ / _\` |/ _ \\
 | |__| (_) | (_| (_| | | |__| (_) | (_| |  __/
 |_____\\___/ \\___\\__,_|_|\\____\\___/ \\__,_|\\___|
\x1b[0m`);
    console.log(
      `  \x1b[1mv${this.config.getVersion()}\x1b[0m | ${backend}: \x1b[33m${model}\x1b[0m`,
    );
    console.log("  Type /help for commands, Ctrl+D to exit\n");

    const askQuestion = (): void => {
      if (!this.running) {
        this.shutdown(historyFile);
        rl.close();
        return;
      }
      rl.question(this.getPrompt(), (answer) => {
        const input = answer.trim();
        if (input === "") {
          askQuestion();
          return;
        }
        this.processInput(input)
          .then(() => {
            askQuestion();
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error: ${msg}`);
            askQuestion();
          });
      });
    };

    rl.on("close", () => {
      this.running = false;
      this.shutdown(historyFile);
    });

    askQuestion();
  }

  private shutdownDone = false;

  private shutdown(historyFile: string): void {
    if (this.shutdownDone) return;
    this.shutdownDone = true;

    // Save history
    if (this.rl !== null) {
      const history = (this.rl as unknown as { history: string[] }).history;
      if (Array.isArray(history)) {
        fs.writeFileSync(historyFile, history.reverse().join("\n"), "utf-8");
      }
    }
    console.log("\nGoodbye!");
  }

  private completer(line: string): [string[], string] {
    const commands = [
      "/help", "/version", "/models", "/model", "/current",
      "/tools", "/permissions", "/mcp", "/save", "/load",
      "/sessions", "/clear", "/pwd", "/cd", "/exit",
    ];

    if (line.startsWith("/")) {
      const hits = commands.filter((c) => c.startsWith(line));
      return [hits.length > 0 ? hits : commands, line];
    }

    return [[], line];
  }
}
