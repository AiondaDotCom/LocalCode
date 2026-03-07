import * as fs from "node:fs";
import * as path from "node:path";
import { glob as globFn } from "node:fs";
import type { ToolResult } from "../types.js";
import type { LocalTool } from "../mcp/servers/local.js";

async function toolRead(args: Record<string, string>): Promise<ToolResult> {
  const file = args["file"] ?? args["path"] ?? "";
  if (file === "") {
    return { tool: "read", success: false, output: "Missing file argument" };
  }

  try {
    const content = fs.readFileSync(file, "utf-8");
    return { tool: "read", success: true, output: content };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: "read", success: false, output: msg };
  }
}

async function toolWrite(args: Record<string, string>): Promise<ToolResult> {
  const file = args["file"] ?? args["path"] ?? "";
  const content = args["content"] ?? "";
  if (file === "") {
    return { tool: "write", success: false, output: "Missing file argument" };
  }

  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(file, content.endsWith("\n") ? content : content + "\n", "utf-8");
    return { tool: "write", success: true, output: `Written to ${file}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: "write", success: false, output: msg };
  }
}

async function toolEdit(args: Record<string, string>): Promise<ToolResult> {
  const file = args["file"] ?? args["path"] ?? "";
  const oldText = args["old"] ?? args["old_string"] ?? "";
  const newText = args["new"] ?? args["new_string"] ?? "";

  if (file === "" || oldText === "") {
    return { tool: "edit", success: false, output: "Missing file or old text argument" };
  }

  try {
    const content = fs.readFileSync(file, "utf-8");
    if (!content.includes(oldText)) {
      return { tool: "edit", success: false, output: "Old text not found in file" };
    }
    const updated = content.replace(oldText, newText);
    fs.writeFileSync(file, updated, "utf-8");
    return { tool: "edit", success: true, output: `Edited ${file}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: "edit", success: false, output: msg };
  }
}

async function toolGlob(args: Record<string, string>): Promise<ToolResult> {
  const pattern = args["pattern"] ?? "";
  const dir = args["dir"] ?? args["path"] ?? process.cwd();

  if (pattern === "") {
    return { tool: "glob", success: false, output: "Missing pattern argument" };
  }

  return new Promise((resolve) => {
    const fullPattern = path.join(dir, pattern);
    globFn(fullPattern, (err, matches) => {
      if (err !== null) {
        resolve({
          tool: "glob",
          success: false,
          output: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      resolve({
        tool: "glob",
        success: true,
        output: matches.join("\n"),
      });
    });
  });
}

async function toolGrep(args: Record<string, string>): Promise<ToolResult> {
  const pattern = args["pattern"] ?? "";
  const file = args["file"] ?? args["path"] ?? "";

  if (pattern === "" || file === "") {
    return { tool: "grep", success: false, output: "Missing pattern or file argument" };
  }

  try {
    const content = fs.readFileSync(file, "utf-8");
    const regex = new RegExp(pattern, "gi");
    const lines = content.split("\n");
    const matches: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && regex.test(line)) {
        matches.push(`${String(i + 1)}: ${line}`);
        regex.lastIndex = 0;
      }
    }

    if (matches.length === 0) {
      return { tool: "grep", success: true, output: "No matches found" };
    }
    return { tool: "grep", success: true, output: matches.join("\n") };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: "grep", success: false, output: msg };
  }
}

async function toolList(args: Record<string, string>): Promise<ToolResult> {
  const dir = args["path"] ?? args["dir"] ?? process.cwd();

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const output = entries
      .filter((e) => e.name !== "." && e.name !== "..")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .join("\n");
    return { tool: "list", success: true, output };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: "list", success: false, output: msg };
  }
}

export const fileTools: LocalTool[] = [
  {
    name: "read",
    description: "Read a file's contents",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "File path to read" },
      },
      required: ["file"],
    },
    permissionLevel: "safe",
    handler: toolRead,
  },
  {
    name: "write",
    description: "Write content to a file",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "File path to write" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["file", "content"],
    },
    permissionLevel: "dangerous",
    handler: toolWrite,
  },
  {
    name: "edit",
    description: "Edit a file by replacing text",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "File path to edit" },
        old: { type: "string", description: "Text to replace" },
        new: { type: "string", description: "Replacement text" },
      },
      required: ["file", "old", "new"],
    },
    permissionLevel: "dangerous",
    handler: toolEdit,
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern" },
        dir: { type: "string", description: "Base directory" },
      },
      required: ["pattern"],
    },
    permissionLevel: "safe",
    handler: toolGlob,
  },
  {
    name: "grep",
    description: "Search for a pattern in a file",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search" },
        file: { type: "string", description: "File path to search" },
      },
      required: ["pattern", "file"],
    },
    permissionLevel: "safe",
    handler: toolGrep,
  },
  {
    name: "list",
    description: "List directory contents",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to list" },
      },
    },
    permissionLevel: "safe",
    handler: toolList,
  },
];
