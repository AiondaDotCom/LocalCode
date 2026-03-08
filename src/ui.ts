import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Client } from "./client.js";
import type { Session } from "./session.js";
import type { Permissions } from "./permissions.js";
import type { Config } from "./config.js";
import type { MCPManager } from "./mcp/manager.js";
import type { MCPRegistry } from "./mcp/registry.js";
import type { ToolCall, ToolResult, MCPToolInfo, ChatResponse, Message } from "./types.js";
import {
  getLocalTools,
  getLocalToolPermission,
  executeLocalTool,
} from "./mcp/servers/local.js";
import { loadContextFiles, buildContextPrompt } from "./context.js";
import { createMCPTools } from "./tools/mcp.js";
import type { LocalTool } from "./mcp/servers/local.js";
import { LRUCache } from "./lru-cache.js";

interface UsageStats {
  total_tokens: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_requests: number;
  total_tool_calls: number;
  first_used: string;
  last_used: string;
}

const STATS_FILE = path.join(
  process.env["HOME"] ?? "",
  ".localcode",
  "stats.json",
);

function loadStats(): UsageStats {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, "utf-8")) as UsageStats;
    }
  } catch {
    // ignore
  }
  return {
    total_tokens: 0,
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    total_requests: 0,
    total_tool_calls: 0,
    first_used: new Date().toISOString(),
    last_used: new Date().toISOString(),
  };
}

function saveStats(stats: UsageStats): void {
  try {
    const dir = path.dirname(STATS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2) + "\n", "utf-8");
  } catch {
    // ignore
  }
}

export class UI {
  private client: Client;
  private session: Session;
  private permissions: Permissions;
  private config: Config;
  private mcpManager: MCPManager;
  private mcpTools: LocalTool[];
  private rl: readline.Interface | null = null;
  private running = false;
  private abortController: AbortController | null = null;
  private stats: UsageStats = loadStats();
  private sessionTokens = 0;
  private sessionPromptTokens = 0;
  private sessionCompletionTokens = 0;
  private sessionRequests = 0;
  private sessionToolCalls = 0;
  private sessionStart = new Date();

  constructor(
    client: Client,
    session: Session,
    permissions: Permissions,
    config: Config,
    mcpManager: MCPManager,
    mcpRegistry: MCPRegistry,
  ) {
    this.client = client;
    this.session = session;
    this.permissions = permissions;
    this.config = config;
    this.mcpManager = mcpManager;
    this.mcpTools = createMCPTools(mcpRegistry, mcpManager);
  }

  /** Build tool list for system prompt with exact names and parameters */
  private buildToolsPrompt(): string[] {
    const tools = this.buildToolsArray();
    return tools.map((t) => {
      const params = Object.entries(t.function.parameters.properties ?? {} as Record<string, { type?: string; description?: string }>)
        .map(([name, schema]) => {
          const s = schema as { type?: string; description?: string };
          return `${name}${s.type ? `: ${s.type}` : ""}`;
        })
        .join(", ");
      return `- ${t.function.name}(${params}) — ${t.function.description}`;
    });
  }

  /** Strip <think>...</think> and <final>...</final> tags from stored content */
  private stripReasoningTags(text: string): string {
    return text
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/<\/?final>/g, "")
      .trim();
  }

  buildSystemPrompt(): string {
    const contextFiles = loadContextFiles(process.cwd());
    const contextPrompt = buildContextPrompt(contextFiles);
    const cwd = process.cwd();
    const model = this.client.getCurrentModel() ?? "unknown";
    const backend = this.client.getBackend();
    const platform = process.platform;
    const shell = process.env["SHELL"] ?? "unknown";
    const arch = process.arch;

    return [
      // Identity
      "You are LocalCode, an AI coding agent. You help with software engineering tasks.",
      "",

      // Runtime info
      "# Runtime",
      `- Working directory: ${cwd}`,
      `- Platform: ${platform} (${arch})`,
      `- Shell: ${shell}`,
      `- Model: ${model} (${backend})`,
      `- Date: ${new Date().toISOString().slice(0, 10)}`,
      "",

      // Tool calling style (minimal narration)
      "# Tool Calling",
      "Call tools directly. Keep narration minimal — only explain when the action is complex or destructive.",
      "Do NOT show code in text. Use tool calls for all actions.",
      "Never fabricate tool results. Call the tool for each item separately.",
      "",

      // Available tools — built-in + dynamic MCP tools
      "# Tools",
      "IMPORTANT: Use EXACT tool names as listed. Do NOT invent or guess tool names.",
      "",
      ...this.buildToolsPrompt(),
      "",


      // Context files
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
      ...this.mcpTools.map((t) => ({
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

  private extractBashBlocks(content: string): ToolCall[] {
    const calls: ToolCall[] = [];
    // Match ```bash, ```sh, or ```shell blocks (flexible whitespace)
    const blockRegex = /`{3,}\s*(?:bash|sh|shell)\s*\r?\n([\s\S]*?)`{3,}/g;
    let match;
    while ((match = blockRegex.exec(content)) !== null) {
      const block = match[1] ?? "";
      for (const raw of block.split(/\r?\n/)) {
        const cmd = raw.trim();
        if (cmd !== "" && !cmd.startsWith("#")) {
          calls.push({
            name: "mcp__local__bash",
            arguments: { command: cmd },
          });
        }
      }
    }
    // Fallback: detect standalone command lines like "$ cmd" or "> cmd"
    if (calls.length === 0) {
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const m = /^\s*[\$>]\s+(.+)$/.exec(line);
        if (m !== null) {
          const cmd = (m[1] ?? "").trim();
          if (cmd !== "") {
            calls.push({
              name: "mcp__local__bash",
              arguments: { command: cmd },
            });
          }
        }
      }
    }
    return calls;
  }

  async executeTool(call: ToolCall): Promise<ToolResult> {
    const resolved = this.mcpManager.resolveToolCall(call.name);

    if (resolved !== null && resolved.serverName !== "local") {
      // External MCP tool — show parameters before permission prompt
      const argsDisplay = Object.entries(call.arguments)
        .map(([k, v]) => `${k}=${typeof v === "string" && v.length > 80 ? `${v.slice(0, 80)}...` : String(v)}`)
        .join(", ");
      console.log(`\x1b[90m  → ${resolved.serverName}.${resolved.toolName}(${argsDisplay})\x1b[0m`);
      const allowed = await this.permissions.requestPermission(
        call.name,
        argsDisplay,
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

    // Local tool (built-in or MCP management)
    const toolName = resolved?.toolName ?? call.name;

    // Check if it's an MCP management tool
    const mcpTool = this.mcpTools.find((t) => t.name === toolName);
    if (mcpTool !== undefined) {
      if (mcpTool.permissionLevel === "dangerous") {
        const allowed = await this.permissions.requestPermission(
          "shell_exec",
          `${toolName}: ${JSON.stringify(call.arguments)}`,
        );
        if (!allowed) {
          return { tool: toolName, success: false, output: "Permission denied" };
        }
      }
      return await mcpTool.handler(call.arguments);
    }

    const permission = getLocalToolPermission(toolName);

    if (permission === "dangerous") {
      const allowed = await this.permissions.requestPermission(
        toolName,
        JSON.stringify(call.arguments),
      );
      if (!allowed) {
        return {
          tool: toolName,
          success: false,
          output: "Permission denied",
        };
      }
    }

    return await executeLocalTool(toolName, call.arguments);
  }

  formatToolResults(results: ToolResult[]): string {
    return results
      .map(
        (r) =>
          `[${r.success ? "OK" : "ERR"}] ${r.tool}: ${this.compactOutput(r.output)}`,
      )
      .join("\n\n");
  }

  private compactOutput(output: string): string {
    // Try to extract key info from JSON tool results
    try {
      const parsed = JSON.parse(output) as unknown;

      // Handle arrays (e.g. listKnownHosts) — compact summary
      if (Array.isArray(parsed)) {
        const items = parsed as Array<Record<string, unknown>>;
        const summarize = (item: Record<string, unknown>): string => {
          const alias = item["alias"] ?? "";
          const host = item["hostname"] ?? item["name"] ?? item["host"] ?? "";
          const src = item["source"] ?? "";
          const label = alias !== "" ? String(alias) : String(host);
          return src ? `${label} (${String(src)})` : label;
        };
        const lines = items.map(summarize);
        if (items.length <= 30) {
          return `${String(items.length)} items: ${lines.join(", ")}`;
        }
        return `${String(items.length)} items: ${lines.slice(0, 15).join(", ")}, ... ${lines.slice(-5).join(", ")}`;
      }

      // Handle objects with stdout/stderr/code
      const obj = parsed as Record<string, unknown>;
      const parts: string[] = [];
      if (typeof obj["stdout"] === "string" && obj["stdout"] !== "") {
        parts.push(obj["stdout"].trim());
      }
      if (typeof obj["stderr"] === "string" && obj["stderr"] !== "") {
        parts.push(`stderr: ${(obj["stderr"] as string).trim()}`);
      }
      if (obj["code"] !== undefined && obj["code"] !== 0) {
        parts.push(`exit ${String(obj["code"])}`);
      }
      // Handle runCommandBatch results
      if (Array.isArray(obj["results"])) {
        for (const r of obj["results"] as Array<Record<string, unknown>>) {
          if (typeof r["stdout"] === "string" && r["stdout"] !== "") {
            parts.push(r["stdout"].trim());
          }
          if (typeof r["stderr"] === "string" && r["stderr"] !== "") {
            parts.push(`stderr: ${(r["stderr"] as string).trim()}`);
          }
        }
      }
      if (parts.length > 0) return parts.join("\n");
    } catch {
      // Not JSON, use as-is
    }
    // Truncate very long output but keep head + tail
    if (output.length > 2000) {
      return `${output.slice(0, 1500)}\n[...${String(output.length - 2000)} chars truncated...]\n${output.slice(-500)}`;
    }
    return output;
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

      case "/stats":
        this.showStats();
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

      case "/compact":
        await this.compactHistory();
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

      case "/init":
        await this.generateInit();
        return true;

      case "/mlx":
        await this.handleMLXCommand(arg);
        return true;

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
  /compact         Compress conversation history
  /init            Generate LOCALCODE.md in current directory
  /mlx <cmd>       MLX server: start, stop, restart, status
  /pwd             Show working directory
  /cd [path]       Change directory
  /stats           Show token usage statistics
  /version         Show version
  /help            Show this help
  /exit            Exit
`.trim());
  }

  private async generateInit(): Promise<void> {
    const cwd = process.cwd();
    const targetFile = path.join(cwd, "LOCALCODE.md");

    if (fs.existsSync(targetFile)) {
      console.log(`LOCALCODE.md already exists at ${targetFile}`);
      return;
    }

    // Gather project context for the LLM
    process.stdout.write("\x1b[90mAnalyzing project...\x1b[0m\r");
    const projectInfo = this.gatherProjectInfo(cwd);

    const messages: Message[] = [
      {
        role: "system",
        content: `You are generating a LOCALCODE.md file for an AI coding agent. This file tells the agent about the project so it can work effectively. Write ONLY the markdown content, no explanations.

The file should include:
- Project name and brief description
- Tech stack and key dependencies
- Project structure (key directories)
- How to build, test, and run
- Coding conventions and patterns used
- Important notes (gotchas, things to avoid, architectural decisions)

Keep it concise and practical. Focus on information an AI agent needs to work on this codebase. Use sections with ## headings. Do not include generic advice — be specific to THIS project.`,
      },
      {
        role: "user",
        content: `Analyze this project and generate a LOCALCODE.md:\n\n${projectInfo}`,
      },
    ];

    try {
      process.stdout.write("\x1b[2K\x1b[90mGenerating LOCALCODE.md...\x1b[0m\r");
      const response = await this.client.chat(messages);
      const content = response.message.content.trim();
      process.stdout.write("\x1b[2K");

      if (content.length < 50) {
        console.log("LLM response too short. Try again.");
        return;
      }

      fs.writeFileSync(targetFile, content + "\n", "utf-8");
      console.log(`Created ${targetFile}`);
    } catch (err: unknown) {
      process.stdout.write("\x1b[2K");
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to generate: ${msg}`);
    }
  }

  private gatherProjectInfo(cwd: string): string {
    const parts: string[] = [];
    const projectName = path.basename(cwd);
    parts.push(`Project directory: ${projectName}`);

    // package.json
    const pkgPath = path.join(cwd, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = fs.readFileSync(pkgPath, "utf-8");
        parts.push(`\n--- package.json ---\n${pkg}`);
      } catch { /* ignore */ }
    }

    // Cargo.toml, pyproject.toml, go.mod, Makefile, etc.
    const configFiles = [
      "Cargo.toml", "pyproject.toml", "setup.py", "go.mod",
      "Makefile", "CMakeLists.txt", "Gemfile", "composer.json",
      "pom.xml", "build.gradle", "angular.json", "tsconfig.json",
    ];
    for (const f of configFiles) {
      const fp = path.join(cwd, f);
      if (fs.existsSync(fp)) {
        try {
          const content = fs.readFileSync(fp, "utf-8");
          const truncated = content.split("\n").slice(0, 50).join("\n");
          parts.push(`\n--- ${f} ---\n${truncated}`);
        } catch { /* ignore */ }
      }
    }

    // Directory listing (top-level + src/)
    try {
      const entries = fs.readdirSync(cwd, { withFileTypes: true });
      const listing = entries
        .map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`)
        .join("\n");
      parts.push(`\n--- Directory listing ---\n${listing}`);
    } catch { /* ignore */ }

    // src/ listing if exists
    const srcDir = path.join(cwd, "src");
    if (fs.existsSync(srcDir)) {
      try {
        const srcEntries = fs.readdirSync(srcDir, { withFileTypes: true });
        const srcListing = srcEntries
          .map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`)
          .join("\n");
        parts.push(`\n--- src/ listing ---\n${srcListing}`);
      } catch { /* ignore */ }
    }

    // README (first 80 lines)
    for (const readme of ["README.md", "README", "README.txt", "readme.md"]) {
      const rp = path.join(cwd, readme);
      if (fs.existsSync(rp)) {
        try {
          const content = fs.readFileSync(rp, "utf-8");
          const truncated = content.split("\n").slice(0, 80).join("\n");
          parts.push(`\n--- ${readme} (first 80 lines) ---\n${truncated}`);
        } catch { /* ignore */ }
        break;
      }
    }

    // Existing CLAUDE.md (to incorporate)
    const claudeMd = path.join(cwd, "CLAUDE.md");
    if (fs.existsSync(claudeMd)) {
      try {
        const content = fs.readFileSync(claudeMd, "utf-8");
        const truncated = content.split("\n").slice(0, 100).join("\n");
        parts.push(`\n--- Existing CLAUDE.md (first 100 lines) ---\n${truncated}`);
      } catch { /* ignore */ }
    }

    return parts.join("\n");
  }

  private async handleMLXCommand(arg: string): Promise<void> {
    if (process.env["LOCALCODE_SANDBOX"] === "1") {
      console.log("\x1b[33mMLX server control is not available in sandbox mode.\x1b[0m");
      console.log("\x1b[90mThe MLX server runs on the host — manage it outside the container.\x1b[0m");
      return;
    }

    const { startMLXServer, stopMLXServer } = await import("./mlx.js");
    const port = this.config.getBackendConfig().port;

    switch (arg) {
      case "start":
        await startMLXServer(port);
        await this.client.connect();
        break;
      case "stop":
        stopMLXServer();
        this.client.disconnect();
        break;
      case "restart":
        stopMLXServer();
        await new Promise((r) => setTimeout(r, 2000));
        await startMLXServer(port);
        await this.client.connect();
        break;
      case "status": {
        const status = this.client.getStatus();
        console.log(`MLX server: ${status === "connected" ? "\x1b[32mconnected\x1b[0m" : "\x1b[31mdisconnected\x1b[0m"}`);
        break;
      }
      default:
        console.log("Usage: /mlx <start|stop|restart|status>");
    }
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

  private showStats(): void {
    const elapsed = Date.now() - this.sessionStart.getTime();
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    const duration = mins > 0 ? `${String(mins)}m ${String(secs)}s` : `${String(secs)}s`;

    const fmt = (n: number): string => n.toLocaleString();

    console.log(`\n\x1b[1mSession:\x1b[0m`);
    console.log(`  Duration:      ${duration}`);
    console.log(`  Requests:      ${fmt(this.sessionRequests)}`);
    console.log(`  Tool calls:    ${fmt(this.sessionToolCalls)}`);
    console.log(`  Input tokens:  ${fmt(this.sessionPromptTokens)}`);
    console.log(`  Output tokens: ${fmt(this.sessionCompletionTokens)}`);
    console.log(`  Total tokens:  ${fmt(this.sessionTokens)}`);

    console.log(`\n\x1b[1mAll time:\x1b[0m`);
    console.log(`  Requests:      ${fmt(this.stats.total_requests)}`);
    console.log(`  Tool calls:    ${fmt(this.stats.total_tool_calls)}`);
    console.log(`  Input tokens:  ${fmt(this.stats.total_prompt_tokens)}`);
    console.log(`  Output tokens: ${fmt(this.stats.total_completion_tokens)}`);
    console.log(`  Total tokens:  ${fmt(this.stats.total_tokens)}`);
    console.log(`  Since:         ${this.stats.first_used.slice(0, 10)}`);
  }

  private showPermissions(): void {
    const allowed = this.permissions.getRememberedTools();
    if (allowed.length > 0) {
      console.log("\n\x1b[32mAlways allowed:\x1b[0m");
      for (const t of allowed) {
        console.log(`  ${t}`);
      }
    }
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
    const running = this.mcpManager.getStatus();
    if (running.length === 0) {
      console.log("No MCP servers configured");
      return;
    }
    for (const s of running) {
      const status = s.connected ? "\x1b[32mconnected\x1b[0m" : "\x1b[31mdisconnected\x1b[0m";
      console.log(`  ${s.name}: ${status} (${String(s.tools.length)} tools)`);
    }
  }

  private async compactHistory(): Promise<void> {
    const estimated = this.session.estimateTokenCount();
    const msgCount = this.session.getMessageCount();
    if (msgCount < 4) {
      console.log("Not enough history to compact");
      return;
    }

    process.stdout.write("\x1b[90mCompacting conversation...\x1b[0m\r");

    const summarizer = async (messages: Message[]): Promise<string> => {
      const summaryMessages: Message[] = [
        {
          role: "system",
          content: "Summarize the following conversation in 2-3 concise sentences. Focus on what was done, key decisions, and current state. Be brief.",
        },
        {
          role: "user",
          content: messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"),
        },
      ];
      const resp = await this.client.chat(summaryMessages);
      return resp.message.content;
    };

    const compressed = await this.session.compressHistory(summarizer);
    process.stdout.write("\x1b[2K");
    if (compressed) {
      const newEstimate = this.session.estimateTokenCount();
      const saved = estimated - newEstimate;
      console.log(`\x1b[32mCompacted: ~${String(saved)} tokens freed (${String(msgCount)} → ${String(this.session.getMessageCount())} messages)\x1b[0m`);
    } else {
      console.log("Could not compact history");
    }
  }

  private async autoCompressIfNeeded(): Promise<void> {
    const ctx = this.client.getContextStats();
    const usedTokens = ctx.prompt_tokens > 0
      ? ctx.prompt_tokens + ctx.completion_tokens
      : this.session.estimateTokenCount();
    const pct = ctx.context_window > 0
      ? (usedTokens / ctx.context_window) * 100
      : 0;

    if (pct > 70 && this.session.getMessageCount() >= 6) {
      console.log(`\x1b[33mContext at ${Math.round(pct)}% — auto-compacting...\x1b[0m`);
      await this.compactHistory();
    }
  }

  private showGenerationStats(response: ChatResponse): void {
    const parts: string[] = [];
    if (response.tokens_per_second !== undefined) {
      parts.push(`${String(response.tokens_per_second)} tok/s`);
    }
    if (response.generation_time_ms !== undefined) {
      const secs = (response.generation_time_ms / 1000).toFixed(1);
      parts.push(`${secs}s`);
    }
    const ctx = this.client.getContextStats();
    if (ctx.completion_tokens > 0) {
      parts.push(`${String(ctx.completion_tokens)} tokens`);
    }

    // Track session stats
    this.sessionPromptTokens += ctx.prompt_tokens;
    this.sessionCompletionTokens += ctx.completion_tokens;
    this.sessionTokens += ctx.prompt_tokens + ctx.completion_tokens;
    this.sessionRequests++;

    // Track cumulative stats
    this.stats.total_prompt_tokens += ctx.prompt_tokens;
    this.stats.total_completion_tokens += ctx.completion_tokens;
    this.stats.total_tokens += ctx.prompt_tokens + ctx.completion_tokens;
    this.stats.total_requests++;
    this.stats.last_used = new Date().toISOString();
    saveStats(this.stats);
    // Use actual prompt_tokens from server if available, else estimate
    const usedTokens = ctx.prompt_tokens > 0
      ? ctx.prompt_tokens + ctx.completion_tokens
      : this.session.estimateTokenCount();
    const pct = ctx.context_window > 0
      ? Math.round((usedTokens / ctx.context_window) * 100)
      : 0;
    parts.push(`ctx ${String(pct)}%`);
    if (parts.length > 0) {
      console.log(`\x1b[90m[${parts.join(" | ")}]\x1b[0m`);
    }
  }

  private getPrompt(): string {
    const ctx = this.client.getContextStats();
    const model = this.client.getCurrentModel() ?? "no model";
    const usedTokens = ctx.prompt_tokens > 0
      ? ctx.prompt_tokens + ctx.completion_tokens
      : this.session.estimateTokenCount();
    const pct = ctx.context_window > 0
      ? Math.round((usedTokens / ctx.context_window) * 100)
      : 0;
    const pctStr = pct > 0 ? ` ${String(pct)}%` : "";
    const color = pct > 80 ? "\x1b[31m" : pct > 50 ? "\x1b[33m" : "\x1b[36m";
    return `${color}${model}${pctStr}\x1b[0m> `;
  }

  async processInput(input: string): Promise<void> {
    if (input.startsWith("/")) {
      const handled = await this.handleSlashCommand(input);
      if (handled) return;
    }

    // ! prefix: direct shell execution without AI
    if (input.startsWith("!")) {
      const cmd = input.slice(1).trim();
      if (cmd === "") return;
      try {
        const { execSync } = await import("node:child_process");
        const output = execSync(cmd, { cwd: process.cwd(), stdio: "inherit", timeout: 60000 });
      } catch {
        // exit code shown by stdio: inherit
      }
      return;
    }

    this.session.addMessage("user", input);

    const systemPrompt = this.buildSystemPrompt();
    const messages = this.session.getMessagesForChat(systemPrompt);
    const tools = this.buildToolsArray();
    this.abortController = new AbortController();
    const abortSignal = this.abortController.signal;

    try {
      let boldOpen = false;
      let tokenBuffer = "";
      let firstToken = true;
      let spinnerTimer: ReturnType<typeof setInterval> | null = null;
      const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let spinnerIdx = 0;

      const startSpinner = (): void => {
        firstToken = true;
        spinnerIdx = 0;
        process.stdout.write(`\x1b[90m${spinnerFrames[0]} \x1b[0m`);
        spinnerTimer = setInterval(() => {
          spinnerIdx = (spinnerIdx + 1) % spinnerFrames.length;
          process.stdout.write(`\r\x1b[90m${spinnerFrames[spinnerIdx]} \x1b[0m`);
        }, 80);
      };

      const stopSpinner = (): void => {
        if (spinnerTimer !== null) {
          clearInterval(spinnerTimer);
          spinnerTimer = null;
          process.stdout.write("\r\x1b[2K");
        }
      };

      let trailingNewlines = 0;
      let insideThink = false;
      let thinkBuffer = "";
      const onToken = (token: string): void => {
        if (firstToken) {
          firstToken = false;
          stopSpinner();
        }

        // Accumulate for tag detection
        thinkBuffer += token;

        // Handle <think> opening
        if (!insideThink && thinkBuffer.includes("<think>")) {
          const before = thinkBuffer.slice(0, thinkBuffer.indexOf("<think>"));
          if (before.trim() !== "") outputText(before);
          thinkBuffer = thinkBuffer.slice(thinkBuffer.indexOf("<think>") + 7);
          insideThink = true;
          process.stdout.write("\x1b[90m[thinking...]\x1b[0m");
        }

        // Handle </think> closing
        if (insideThink && thinkBuffer.includes("</think>")) {
          thinkBuffer = thinkBuffer.slice(thinkBuffer.indexOf("</think>") + 8);
          insideThink = false;
          process.stdout.write("\r\x1b[2K");
        }

        // Inside <think> block — suppress output
        if (insideThink) return;

        // Strip complete <final> and </final> tags
        thinkBuffer = thinkBuffer.replace(/<\/?final>/g, "");

        // Hold back if buffer ends with a partial tag (e.g. "<", "<fi", "</fin")
        // to avoid outputting incomplete tags character by character
        const partialTagMatch = thinkBuffer.match(/<[/a-z]*$/i);
        if (partialTagMatch !== null) {
          const safe = thinkBuffer.slice(0, partialTagMatch.index);
          if (safe.length > 0) outputText(safe);
          thinkBuffer = partialTagMatch[0];
          return;
        }

        // Flush processed text
        if (thinkBuffer.length > 0) {
          outputText(thinkBuffer);
          thinkBuffer = "";
        }
      };

      const outputText = (text: string): void => {
        // Suppress excessive trailing newlines (max 2)
        for (const ch of text) {
          if (ch === "\n") {
            trailingNewlines++;
            if (trailingNewlines > 2) continue;
          } else {
            trailingNewlines = 0;
          }
          tokenBuffer += ch;
        }
        // Process all complete ** markers in the buffer
        while (tokenBuffer.includes("**")) {
          const idx = tokenBuffer.indexOf("**");
          if (idx > 0) {
            process.stdout.write(tokenBuffer.slice(0, idx));
          }
          boldOpen = !boldOpen;
          process.stdout.write(boldOpen ? "\x1b[1m" : "\x1b[22m");
          tokenBuffer = tokenBuffer.slice(idx + 2);
        }
        // Output everything except a trailing '*' (might be start of **)
        if (tokenBuffer.endsWith("*")) {
          if (tokenBuffer.length > 1) {
            process.stdout.write(tokenBuffer.slice(0, -1));
            tokenBuffer = "*";
          }
        } else {
          process.stdout.write(tokenBuffer);
          tokenBuffer = "";
        }
      };

      // Agentic loop: keep executing tools until model gives pure text
      let currentTools: typeof tools | undefined = tools;
      let maxRounds = Infinity;
      const toolCallCache = new LRUCache<number>(1024);
      let hadToolCalls = false;
      let textOnlyRounds = 0;

      while (maxRounds-- > 0) {
        if (abortSignal.aborted) break;
        const currentMessages = this.session.getMessagesForChat(systemPrompt);

        startSpinner();
        const response = await this.client.chat(currentMessages, undefined, currentTools, onToken, abortSignal);
        stopSpinner();
        if (abortSignal.aborted) {
          const partial = response.message.content;
          if (partial.trim() !== "") {
            this.session.addMessage("assistant", this.stripReasoningTags(partial));
          }
          break;
        }
        const content = response.message.content;
        let toolCalls = response.message.tool_calls ?? this.parseToolCalls(content);

        // Detect ```bash/```sh code blocks and convert to bash tool calls
        if (toolCalls.length === 0) {
          toolCalls = this.extractBashBlocks(content);
          if (toolCalls.length > 0) {
            console.log(`\n\x1b[33m[auto-executing ${String(toolCalls.length)} command${toolCalls.length > 1 ? "s" : ""} from code block]\x1b[0m`);
          }
        }

        if (toolCalls.length === 0) {
          process.stdout.write("\n");
          this.showGenerationStats(response);
          this.session.addMessage("assistant", this.stripReasoningTags(content));

          // If we had tool calls before, check if the original question is answered
          textOnlyRounds++;
          if (hadToolCalls && maxRounds > 1 && textOnlyRounds <= 3) {
            // Ask the model if the original task is complete
            const checkPrompt = `Is the user's original request fully completed? The user asked: "${input}"\nAnswer ONLY "yes" or "no".`;
            const checkMessages: Message[] = [
              { role: "system", content: "Answer only 'yes' or 'no'." },
              { role: "user", content: checkPrompt },
              { role: "assistant", content: content },
            ];
            try {
              const checkResponse = await this.client.chat(checkMessages, undefined, undefined, undefined, abortSignal);
              const answer = checkResponse.message.content.trim().toLowerCase();
              if (answer.startsWith("yes")) {
                break;
              }
            } catch {
              // If check fails, don't retry
              break;
            }

            const nudge = textOnlyRounds === 1
              ? "Continue."
              : "You MUST use tool calls now. Do NOT write text — call a tool to proceed.";
            this.session.addMessage("user", nudge);
            console.log(`\x1b[33m[retry tool calling ${String(textOnlyRounds)}/3]\x1b[0m`);
            continue;
          }
          break;
        }

        // Loop detection: LRU cache tracks last 1024 unique tool call signatures
        const callKey = toolCalls.map((c) => `${c.name}:${JSON.stringify(c.arguments)}`).join("|");
        const seenCount = toolCallCache.get(callKey) ?? 0;
        if (seenCount >= 1) {
          console.log(`\n\x1b[33m[loop detected — duplicate tool call (seen ${String(seenCount + 1)}x), skipping]\x1b[0m`);
          this.showGenerationStats(response);
          this.session.addMessage("assistant", this.stripReasoningTags(content));
          toolCallCache.set(callKey, seenCount + 1);
          if (seenCount >= 2) {
            // 3rd duplicate: give up, force text-only response
            this.session.addMessage("tool", "STOP calling tools. You are in a loop. Answer the user's question NOW using the results you already have.");
            currentTools = undefined;
          } else {
            // 2nd duplicate: warn and remove tools for next round
            this.session.addMessage("tool", "You already called this exact tool with these arguments. The result is above. Use the previous result to answer. Do NOT call any more tools.");
            currentTools = undefined;
          }
          continue;
        }
        toolCallCache.set(callKey, 1);
        hadToolCalls = true;
        textOnlyRounds = 0;

        // Tool calls detected
        if (content.trim() !== "") {
          process.stdout.write("\n");
        }
        this.showGenerationStats(response);

        const results: ToolResult[] = [];
        for (const call of toolCalls) {
          if (abortSignal.aborted) break;
          const result = await this.executeTool(call);
          results.push(result);
          this.stats.total_tool_calls++;
          this.sessionToolCalls++;
          // Show each result immediately
          const tag = result.success ? "\x1b[32m[OK]\x1b[0m" : "\x1b[31m[ERR]\x1b[0m";
          console.log(`\n${tag} ${result.tool}:\n${this.compactOutput(result.output)}`);
        }
        if (abortSignal.aborted) {
          this.session.addMessage("assistant", this.stripReasoningTags(content));
          break;
        }

        const resultText = this.formatToolResults(results);

        this.session.addMessage("assistant", this.stripReasoningTags(content));
        this.session.addMessage("tool", resultText);

        // Next round: keep tools available so model can make further calls
        // Loop detection prevents duplicate commands
      }
    } catch (err: unknown) {
      if (!abortSignal.aborted) {
        const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
        console.error(`\x1b[31mError: ${msg}\x1b[0m`);
      }
    } finally {
      this.abortController = null;
    }

    await this.autoCompressIfNeeded();
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

    // ESC key listener for aborting operations
    const onKeypress = (data: Buffer): void => {
      // ESC = 0x1b, but arrow keys etc. send \x1b[ sequences
      // Lone ESC: just the single byte \x1b
      if (data.length === 1 && data[0] === 0x1b && this.abortController !== null) {
        this.abortController.abort();
        process.stdout.write("\n\x1b[33m[interrupted]\x1b[0m\n");
      }
    };
    process.stdin.on("data", onKeypress);

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

    return new Promise<void>((resolve) => {
      rl.on("close", () => {
        this.running = false;
        this.shutdown(historyFile);
        resolve();
      });

      askQuestion();
    });
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
      "/sessions", "/clear", "/compact", "/init", "/mlx", "/stats", "/pwd", "/cd", "/exit",
    ];

    if (line.startsWith("/")) {
      const hits = commands.filter((c) => c.startsWith(line));
      return [hits.length > 0 ? hits : commands, line];
    }

    return [[], line];
  }
}
