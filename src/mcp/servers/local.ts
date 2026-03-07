import type { MCPToolInfo, ToolResult } from "../../types.js";
import { fileTools } from "../../tools/file.js";
import { execTools } from "../../tools/exec.js";
import { webTools } from "../../tools/web.js";

export interface LocalTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permissionLevel: "safe" | "dangerous";
  handler: (args: Record<string, string>) => Promise<ToolResult>;
}

const allLocalTools: LocalTool[] = [
  ...fileTools,
  ...execTools,
  ...webTools,
];

export function getLocalTools(): MCPToolInfo[] {
  return allLocalTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    server: "local",
  }));
}

export function getLocalToolPermission(
  name: string,
): "safe" | "dangerous" | null {
  const tool = allLocalTools.find((t) => t.name === name);
  return tool?.permissionLevel ?? null;
}

export async function executeLocalTool(
  name: string,
  args: Record<string, string>,
): Promise<ToolResult> {
  const tool = allLocalTools.find((t) => t.name === name);
  if (tool === undefined) {
    return { tool: name, success: false, output: `Unknown tool: ${name}` };
  }

  try {
    return await tool.handler(args);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: name, success: false, output: msg };
  }
}
