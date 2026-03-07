import * as http from "node:http";
import type {
  BackendConfig,
  ChatResponse,
  ContextStats,
  Message,
  ModelInfo,
} from "./types.js";
import { stopMLXServer, startMLXServer } from "./mlx.js";

const noKeepAliveAgent = new http.Agent({ keepAlive: false });

async function restartMlxServer(port: number): Promise<boolean> {
  stopMLXServer();
  await new Promise((r) => setTimeout(r, 2000));
  process.stderr.write("\x1b[33mRestarting MLX server...\x1b[0m\n");
  return startMLXServer(port);
}

async function httpPostWithRetry(
  url: string,
  body: string,
  timeout: number,
  port: number,
  backend: "mlx" | "ollama",
  retries = 3,
  delayMs = 5000,
): Promise<{ status: number; body: string }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await httpPost(url, body, timeout);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = msg.includes("socket hang up") || msg.includes("ECONNRESET") || msg.includes("ECONNREFUSED");
      if (!isRetryable || attempt === retries) {
        throw err;
      }

      if (attempt < 2) {
        // First retries: just wait
        const wait = delayMs * (attempt + 1);
        process.stderr.write(`\x1b[90mBackend busy, retrying in ${String(wait / 1000)}s...\x1b[0m\r`);
        await new Promise((r) => setTimeout(r, wait));
      } else if (backend === "mlx") {
        // Last resort: restart MLX server
        process.stderr.write("\x1b[2K");
        const restarted = await restartMlxServer(port);
        if (restarted) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  }
  throw new Error("Unreachable");
}

function httpPost(url: string, body: string, timeout: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: "POST",
        agent: noKeepAliveAgent,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.write(body);
    req.end();
  });
}

function httpGet(url: string, timeout: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: "GET",
        agent: noKeepAliveAgent,
        timeout,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.end();
  });
}

export class Client {
  private backend: "mlx" | "ollama";
  private host: string;
  private port: number;
  private timeout: number;
  private defaultModel: string;
  private currentModel: string | null = null;
  private availableModels: string[] = [];
  private status: "connected" | "disconnected" = "disconnected";
  private contextWindow: number;
  private maxTokens: number;
  private promptTokens = 0;
  private completionTokens = 0;

  constructor(
    backend: "mlx" | "ollama",
    config: BackendConfig,
  ) {
    this.backend = backend;
    this.host = config.host;
    this.port = config.port;
    this.timeout = config.timeout * 1000;
    this.defaultModel = config.default_model;
    this.contextWindow = config.context_window ?? 32768;
    this.maxTokens = config.max_tokens ?? 8192;
  }

  private get baseUrl(): string {
    return `http://${this.host}:${String(this.port)}`;
  }

  async connect(): Promise<boolean> {
    try {
      await this.detectAvailableModels();
      this.initializeCurrentModel();
      this.status = "connected";
      if (this.backend === "mlx") {
        await new Promise((r) => setTimeout(r, 500));
      }
      return true;
    } catch {
      this.status = "disconnected";
      return false;
    }
  }

  disconnect(): void {
    this.status = "disconnected";
  }

  getStatus(): "connected" | "disconnected" {
    return this.status;
  }

  async detectAvailableModels(): Promise<string[]> {
    const url =
      this.backend === "mlx"
        ? `${this.baseUrl}/v1/models`
        : `${this.baseUrl}/api/tags`;

    const response = await httpGet(url, this.timeout);

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Failed to fetch models: ${String(response.status)}`);
    }

    const data = JSON.parse(response.body) as Record<string, unknown>;

    if (this.backend === "mlx") {
      const models = data["data"] as Array<{ id: string }> | undefined;
      this.availableModels = models?.map((m) => m.id).sort() ?? [];
    } else {
      const models = data["models"] as Array<{ name: string }> | undefined;
      this.availableModels = models?.map((m) => m.name).sort() ?? [];
    }

    return this.availableModels;
  }

  listModels(): string[] {
    return [...this.availableModels];
  }

  validateModel(model: string): boolean {
    return this.availableModels.includes(model);
  }

  private initializeCurrentModel(): void {
    if (
      this.currentModel !== null &&
      this.validateModel(this.currentModel)
    ) {
      return;
    }

    if (this.validateModel(this.defaultModel)) {
      this.currentModel = this.defaultModel;
      return;
    }

    const first = this.availableModels[0];
    if (first !== undefined) {
      this.currentModel = first;
    }
  }

  setModel(model: string): boolean {
    if (!this.validateModel(model)) return false;
    this.currentModel = model;
    return true;
  }

  getCurrentModel(): string | null {
    return this.currentModel;
  }

  getBackend(): "mlx" | "ollama" {
    return this.backend;
  }

  async chat(
    messages: Message[],
    model?: string,
    tools?: Array<{
      type: "function";
      function: { name: string; description: string; parameters: Record<string, unknown> };
    }>,
    onToken?: (token: string) => void,
  ): Promise<ChatResponse> {
    const targetModel = model ?? this.currentModel ?? this.defaultModel;

    if (this.backend === "mlx") {
      return this.mlxChat(messages, targetModel, tools, onToken);
    }
    return this.ollamaChat(messages, targetModel);
  }

  private mlxChat(
    messages: Message[],
    model: string,
    tools?: Array<{
      type: "function";
      function: { name: string; description: string; parameters: Record<string, unknown> };
    }>,
    onToken?: (token: string) => void,
  ): Promise<ChatResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const payload: Record<string, unknown> = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      max_tokens: this.maxTokens,
      chat_template_kwargs: { enable_thinking: false },
    };
    if (tools !== undefined && tools.length > 0) {
      payload["tools"] = tools;
    }

    const body = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const parsed = new URL(url);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          method: "POST",
          agent: noKeepAliveAgent,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: this.timeout,
        },
        (res) => {
          if (res.statusCode !== undefined && (res.statusCode < 200 || res.statusCode >= 300)) {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
              reject(new Error(`MLX API error: ${String(res.statusCode)} ${Buffer.concat(chunks).toString("utf-8")}`));
            });
            return;
          }

          let contentParts: string[] = [];
          let toolCallParts: Array<{ name: string; arguments: string }> = [];
          let buffer = "";
          let tokenCount = 0;

          res.on("data", (chunk: Buffer) => {
            buffer += chunk.toString("utf-8");
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data) as {
                  choices?: Array<{
                    delta?: {
                      content?: string | null;
                      tool_calls?: Array<{
                        function?: { name?: string; arguments?: string };
                      }>;
                    };
                  }>;
                  usage?: { prompt_tokens: number; completion_tokens: number };
                };

                const delta = parsed.choices?.[0]?.delta;
                if (delta?.content) {
                  contentParts.push(delta.content);
                  tokenCount++;
                  if (onToken) onToken(delta.content);
                }
                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    if (tc.function?.name) {
                      toolCallParts.push({
                        name: tc.function.name,
                        arguments: tc.function.arguments ?? "",
                      });
                    } else if (tc.function?.arguments && toolCallParts.length > 0) {
                      const last = toolCallParts[toolCallParts.length - 1];
                      if (last) last.arguments += tc.function.arguments;
                    }
                  }
                }
                if (parsed.usage) {
                  this.promptTokens = parsed.usage.prompt_tokens;
                  this.completionTokens = parsed.usage.completion_tokens;
                }
              } catch {
                // skip malformed SSE chunks
              }
            }
          });

          res.on("end", () => {
            const content = contentParts.join("");
            const toolCalls = toolCallParts.length > 0
              ? toolCallParts.map((tc) => {
                  try {
                    return {
                      name: tc.name,
                      arguments: JSON.parse(tc.arguments) as Record<string, string>,
                    };
                  } catch {
                    return { name: tc.name, arguments: {} };
                  }
                })
              : undefined;

            const elapsed = Date.now() - startTime;
            const tokens = this.completionTokens > 0 ? this.completionTokens : tokenCount;
            if (tokenCount > 0 && this.completionTokens === 0) {
              this.completionTokens = tokenCount;
            }
            const tps = tokens > 0 && elapsed > 0
              ? Math.round((tokens / elapsed) * 1000 * 10) / 10
              : undefined;

            resolve({
              message: {
                role: "assistant",
                content,
                tool_calls: toolCalls,
              },
              done: true,
              generation_time_ms: elapsed,
              tokens_per_second: tps,
            });
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
      req.write(body);
      req.end();
    });
  }

  private async ollamaChat(
    messages: Message[],
    model: string,
  ): Promise<ChatResponse> {
    const url = `${this.baseUrl}/api/chat`;
    const payload = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    };

    const body = JSON.stringify(payload);
    const response = await httpPostWithRetry(url, body, this.timeout, this.port, this.backend);

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Ollama API error: ${String(response.status)} ${response.body}`);
    }

    const data = JSON.parse(response.body) as {
      message: { role: string; content: string };
      done: boolean;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    if (data.prompt_eval_count !== undefined) {
      this.promptTokens = data.prompt_eval_count;
    }
    if (data.eval_count !== undefined) {
      this.completionTokens = data.eval_count;
    }

    return {
      message: {
        role: "assistant",
        content: data.message.content,
      },
      done: data.done,
      prompt_eval_count: data.prompt_eval_count,
      eval_count: data.eval_count,
    };
  }

  getContextStats(): ContextStats {
    const total = this.promptTokens + this.completionTokens;
    const percentage =
      this.contextWindow > 0
        ? Math.round((total / this.contextWindow) * 100)
        : 0;

    return {
      context_window: this.contextWindow,
      prompt_tokens: this.promptTokens,
      completion_tokens: this.completionTokens,
      total_tokens: total,
      percentage,
    };
  }

  async getModelInfo(model: string): Promise<ModelInfo> {
    if (this.backend === "mlx") {
      return { name: model };
    }

    const url = `${this.baseUrl}/api/show`;
    const response = await httpPost(url, JSON.stringify({ name: model }), this.timeout);

    if (response.status < 200 || response.status >= 300) {
      return { name: model };
    }

    const data = JSON.parse(response.body) as Record<string, unknown>;
    return {
      name: model,
      size: data["size"] as number | undefined,
      modified_at: data["modified_at"] as string | undefined,
    };
  }
}
