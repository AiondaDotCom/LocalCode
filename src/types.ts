// ============================================================
// Core Types
// ============================================================

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  timestamp?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  name: string;
  arguments: Record<string, string>;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  output: string;
}

// ============================================================
// Config Types
// ============================================================

export interface BackendConfig {
  host: string;
  port: number;
  default_model: string;
  current_model: string | null;
  timeout: number;
  context_window?: number;
  max_tokens?: number;
}

export interface UIConfig {
  colors: boolean;
  streaming: boolean;
  history_size: number;
  prompt_prefix: string;
}

export interface PermissionsConfig {
  safe_auto_allow: string[];
  dangerous_confirm: string[];
  blocked: string[];
}

export interface TestingConfig {
  auto_approve: boolean;
  auto_deny: boolean;
  simulate_only: boolean;
  mock_execution: boolean;
}

export interface AppConfig {
  backend: "mlx" | "ollama";
  mlx: BackendConfig;
  ollama: BackendConfig;
  ui: UIConfig;
  permissions: PermissionsConfig;
  testing: TestingConfig;
}

// ============================================================
// Permission Types
// ============================================================

export const PermissionLevel = {
  SAFE: 0,
  DANGEROUS: 1,
  BLOCKED: 2,
} as const;

export type PermissionLevelValue =
  (typeof PermissionLevel)[keyof typeof PermissionLevel];

export type TestingMode = "interactive" | "auto_yes" | "auto_no";

export type PermissionResponse = "y" | "n" | "a";

// ============================================================
// MCP Types
// ============================================================

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: "stdio" | "http" | "sse";
  url?: string;
  headers?: Record<string, string>;
}

export interface MCPConfigFile {
  mcpServers: Record<string, MCPServerConfig>;
}

export type MCPScope = "local" | "project" | "user";

export interface MCPServerStatus {
  name: string;
  config: MCPServerConfig;
  connected: boolean;
  tools: MCPToolInfo[];
}

export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  server: string;
}

// ============================================================
// Client Types
// ============================================================

export interface ChatRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  options?: Record<string, unknown>;
}

export interface ChatResponse {
  message: Message;
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface ContextStats {
  context_window: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  percentage: number;
}

export interface ModelInfo {
  name: string;
  size?: number;
  modified_at?: string;
}

// ============================================================
// Session Types
// ============================================================

export interface SessionData {
  name: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
  model?: string;
}

// ============================================================
// Context Types (CLAUDE.md)
// ============================================================

export type ContextScope =
  | "user"
  | "ancestor"
  | "project"
  | "local"
  | "rules"
  | "subdir";

export interface ContextFile {
  path: string;
  content: string;
  scope: ContextScope;
}

// ============================================================
// CLI Types
// ============================================================

export interface CLIOptions {
  help?: boolean;
  version?: boolean;
  backend?: "mlx" | "ollama";
  model?: string;
  autoYes?: boolean;
  autoNo?: boolean;
  simulate?: boolean;
  testMode?: boolean;
  dangerouslySkipPermissions?: boolean;
}
