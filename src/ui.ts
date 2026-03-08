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

  buildSystemPrompt(): string {
    const contextFiles = loadContextFiles(process.cwd());
    const contextPrompt = buildContextPrompt(contextFiles);
    const cwd = process.cwd();

    return [
      "You are LocalCode, an AI coding agent. You help with software engineering tasks.",
      "",
      `Working directory: ${cwd}`,
      "",
      "CRITICAL RULES - YOU MUST FOLLOW THESE:",
      "1. NEVER output code in ```bash or ```sh code blocks. ALWAYS use the bash tool instead.",
      "2. NEVER output file contents in ```code blocks. ALWAYS use the write or edit tool instead.",
      "3. EVERY command must be executed via the bash tool, not shown as text.",
      "4. EVERY file must be created via the write tool, not shown as text.",
      "5. If you catch yourself about to write a code block, STOP and use a tool instead.",
      "",
      "Available tools:",
      "- bash(command): Run ANY shell command (git, npm, cd, ls, make, etc.)",
      "- write(file_path, content): Create or overwrite a file",
      "- edit(file_path, old_text, new_text): Edit part of a file",
      "- read(file_path): Read a file",
      "- grep(pattern, path): Search file contents",
      "- glob(pattern): Find files by name",
      "- list(path): List directory contents",
      "- webfetch(url): Fetch and read a URL",
      "- mcp_add(name, command, args): Add an MCP server (starts immediately)",
      "- mcp_remove(name): Remove an MCP server",
      "- mcp_list(): List MCP servers and their tools",
      "",
      "When the user gives you a URL, FIRST use `webfetch` to read its content.",
      "When the user asks you to install or clone something, use the `bash` tool.",
      "When the user asks you to create a program, use the `write` tool.",
      "When the user asks you to run something, use the `bash` tool.",
      "NEVER show code as text. ALWAYS execute it via tools.",
      "NEVER fabricate, guess, or hallucinate tool results. You MUST call the tool for EACH item separately.",
      "If asked to check multiple servers/files/items, call the tool once for EACH one. Do NOT skip any.",
      "Only report results you actually received from tool calls.",
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
      const onToken = (token: string): void => {
        tokenBuffer += token;
        // Process all complete ** markers in the buffer
        while (tokenBuffer.includes("**")) {
          const idx = tokenBuffer.indexOf("**");
          // Output text before the marker
          if (idx > 0) {
            process.stdout.write(tokenBuffer.slice(0, idx));
          }
          // Toggle bold
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
      let lastCallKey = "";
      let hadToolCalls = false;
      let textOnlyRounds = 0;

      while (maxRounds-- > 0) {
        if (abortSignal.aborted) break;
        const currentMessages = this.session.getMessagesForChat(systemPrompt);

        const response = await this.client.chat(currentMessages, undefined, currentTools, onToken, abortSignal);
        if (abortSignal.aborted) {
          const partial = response.message.content;
          if (partial.trim() !== "") {
            this.session.addMessage("assistant", partial);
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
          this.session.addMessage("assistant", content);

          // If we had tool calls before, nudge the model to continue with tools
          textOnlyRounds++;
          if (hadToolCalls && maxRounds > 1 && textOnlyRounds <= 3) {
            const nudge = textOnlyRounds === 1
              ? "Continue."
              : "You MUST use tool calls now. Do NOT write text — call a tool to proceed.";
            this.session.addMessage("user", nudge);
            console.log(`\x1b[33m[retry tool calling ${String(textOnlyRounds)}/3]\x1b[0m`);
            continue;
          }
          break;
        }

        // Loop detection: only trigger if exact same calls as previous round
        const callKey = toolCalls.map((c) => `${c.name}:${JSON.stringify(c.arguments)}`).join("|");
        if (callKey === lastCallKey) {
          console.log(`\n\x1b[33m[loop detected — skipping duplicate, continuing with results]\x1b[0m`);
          this.showGenerationStats(response);
          // Don't execute again, but add a hint and let model try with text
          this.session.addMessage("assistant", content);
          this.session.addMessage("tool", "You already called this tool and got the result above. Use the previous result to proceed. Do NOT call the same tool again.");
          // One more chance without the duplicate
          lastCallKey = "";
          currentTools = tools;
          continue;
        }
        lastCallKey = callKey;
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
        }
        if (abortSignal.aborted) {
          this.session.addMessage("assistant", content);
          break;
        }

        const resultText = this.formatToolResults(results);
        console.log(`\n${resultText}`);

        this.session.addMessage("assistant", content);
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
      "/sessions", "/clear", "/compact", "/init", "/mlx", "/pwd", "/cd", "/exit",
    ];

    if (line.startsWith("/")) {
      const hits = commands.filter((c) => c.startsWith(line));
      return [hits.length > 0 ? hits : commands, line];
    }

    return [[], line];
  }
}
