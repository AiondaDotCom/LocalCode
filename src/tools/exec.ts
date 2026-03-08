import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import type { ToolResult } from "../types.js";
import type { LocalTool } from "../mcp/servers/local.js";

// Commands that start long-running servers — run in background
const BACKGROUND_PATTERNS = [
  /\bnpm\s+start\b/,
  /\bnpm\s+run\s+(dev|serve|start|watch)\b/,
  /\bng\s+serve\b/,
  /\bnpx\s+(vite|next|nuxt|remix|astro)\b/,
  /\byarn\s+(dev|start|serve)\b/,
  /\bpnpm\s+(dev|start|serve)\b/,
  /\bpython\s+-m\s+http\.server\b/,
  /\bpython.*manage\.py\s+runserver\b/,
  /\bcargo\s+watch\b/,
  /\bdocker\s+compose\s+up(?!\s+-d)\b/,
];

function checkExecutePermission(command: string): string | null {
  const parts = command.trim().split(/\s+/);
  const executable = parts[0];
  if (executable === undefined) return null;

  // Only check local files (starting with ./ or /)
  if (!executable.startsWith("./") && !executable.startsWith("/")) return null;

  if (!fs.existsSync(executable)) return null;

  try {
    fs.accessSync(executable, fs.constants.X_OK);
    return null;
  } catch {
    const stat = fs.statSync(executable);
    const mode = (stat.mode & 0o777).toString(8);
    const ext = executable.split(".").pop() ?? "";

    const interpreters: Record<string, string> = {
      pl: "perl",
      py: "python3",
      rb: "ruby",
      sh: "bash",
      js: "node",
      ts: "tsx",
    };

    const interpreter = interpreters[ext];
    let suggestion = `chmod +x ${executable}`;
    if (interpreter !== undefined) {
      suggestion += ` or run: ${interpreter} ${executable}`;
    }

    return (
      `Permission denied: ${executable} is not executable.\n` +
      `Current permissions: ${mode}\n` +
      `Fix: ${suggestion}`
    );
  }
}

async function toolBash(args: Record<string, string>): Promise<ToolResult> {
  const command = args["command"] ?? args["cmd"] ?? "";
  if (command === "") {
    return { tool: "bash", success: false, output: "Missing command argument" };
  }

  const permError = checkExecutePermission(command);
  if (permError !== null) {
    return { tool: "bash", success: false, output: permError };
  }

  // Detect long-running server commands — run in background
  const isBackground = BACKGROUND_PATTERNS.some((p) => p.test(command));
  if (isBackground) {
    return runInBackground(command);
  }

  try {
    const output = execSync(command, {
      encoding: "utf-8",
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { tool: "bash", success: true, output: output.trimEnd() };
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "stdout" in err &&
      "stderr" in err
    ) {
      const execErr = err as { stdout: string; stderr: string; status: number | null };
      const output = (execErr.stdout + "\n" + execErr.stderr).trim();
      return {
        tool: "bash",
        success: false,
        output: `Exit code ${String(execErr.status ?? 1)}\n${output}`,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: "bash", success: false, output: msg };
  }
}

function runInBackground(command: string): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // After 8 seconds, detach and return what we have
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      child.unref();
      const output = (stdout + "\n" + stderr).trim();
      resolve({
        tool: "bash",
        success: true,
        output: `[Started in background, PID ${String(child.pid)}]\n${output}\n\n(Server is running in the background. Use "!kill ${String(child.pid)}" to stop it.)`,
      });
    }, 8000);

    // If it exits quickly (error), return immediately
    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      const output = (stdout + "\n" + stderr).trim();
      if (code === 0) {
        resolve({ tool: "bash", success: true, output });
      } else {
        resolve({
          tool: "bash",
          success: false,
          output: `Exit code ${String(code ?? 1)}\n${output}`,
        });
      }
    });
  });
}

async function toolTask(args: Record<string, string>): Promise<ToolResult> {
  const command = args["command"] ?? "";
  if (command === "") {
    return { tool: "task", success: false, output: "Missing command argument" };
  }
  // Task delegates to bash with extended timeout
  return toolBash({ command });
}

async function toolTodoRead(): Promise<ToolResult> {
  const todoFile = ".localcode_todo.txt";
  try {
    if (!fs.existsSync(todoFile)) {
      return { tool: "todoread", success: true, output: "No tasks found" };
    }
    const content = fs.readFileSync(todoFile, "utf-8");
    return { tool: "todoread", success: true, output: content };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: "todoread", success: false, output: msg };
  }
}

async function toolTodoWrite(
  args: Record<string, string>,
): Promise<ToolResult> {
  const task = args["task"] ?? args["description"] ?? "";
  if (task === "") {
    return { tool: "todowrite", success: false, output: "Missing task argument" };
  }

  try {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${task}\n`;
    fs.appendFileSync(".localcode_todo.txt", line, "utf-8");
    return { tool: "todowrite", success: true, output: `Added: ${task}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: "todowrite", success: false, output: msg };
  }
}

export const execTools: LocalTool[] = [
  {
    name: "bash",
    description: "Execute a shell command",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
      },
      required: ["command"],
    },
    permissionLevel: "dangerous",
    handler: toolBash,
  },
  {
    name: "task",
    description: "Execute a complex task command",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Task command" },
      },
      required: ["command"],
    },
    permissionLevel: "dangerous",
    handler: toolTask,
  },
  {
    name: "todoread",
    description: "Read the task list",
    inputSchema: { type: "object", properties: {} },
    permissionLevel: "safe",
    handler: toolTodoRead,
  },
  {
    name: "todowrite",
    description: "Add a task to the task list",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Task description" },
      },
      required: ["task"],
    },
    permissionLevel: "dangerous",
    handler: toolTodoWrite,
  },
];
