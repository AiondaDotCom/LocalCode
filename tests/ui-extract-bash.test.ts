import { describe, it, expect } from "vitest";

// Test the extractBashBlocks logic directly (extracted for unit testing)
function extractBashBlocks(content: string): Array<{ name: string; arguments: Record<string, string> }> {
  const calls: Array<{ name: string; arguments: Record<string, string> }> = [];
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

describe("extractBashBlocks", () => {
  it("extracts single bash command from code block", () => {
    const content = "Here is the command:\n\n```bash\nnpm install\n```\n\nDone.";
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments.command).toBe("npm install");
  });

  it("extracts multiple commands from code block (one per line)", () => {
    const content = "```bash\ncd mcp-ssh\nnpm install\nnpm run build\n```";
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.arguments.command).toBe("cd mcp-ssh");
    expect(calls[1]?.arguments.command).toBe("npm install");
    expect(calls[2]?.arguments.command).toBe("npm run build");
  });

  it("skips comment lines in bash blocks", () => {
    const content = "```bash\n# this is a comment\nnpm install\n```";
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments.command).toBe("npm install");
  });

  it("skips empty lines in bash blocks", () => {
    const content = "```bash\nnpm install\n\nnpm run build\n```";
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(2);
  });

  it("handles ```sh blocks", () => {
    const content = "```sh\nls -la\n```";
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments.command).toBe("ls -la");
  });

  it("handles ```shell blocks", () => {
    const content = "```shell\necho hello\n```";
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments.command).toBe("echo hello");
  });

  it("handles multiple code blocks", () => {
    const content = "First:\n```bash\ngit clone repo\n```\nThen:\n```bash\nnpm install\n```";
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.arguments.command).toBe("git clone repo");
    expect(calls[1]?.arguments.command).toBe("npm install");
  });

  it("ignores non-bash code blocks", () => {
    const content = "```python\nprint('hello')\n```\n```json\n{}\n```";
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(0);
  });

  it("handles \\r\\n line endings", () => {
    const content = "```bash\r\nnpm install\r\n```";
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments.command).toBe("npm install");
  });

  it("handles localcode mcp add command", () => {
    const content = "I will install the server:\n\n```bash\nlocalcode mcp add mcp-ssh npx @aiondadotcom/mcp-ssh\n```";
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments.command).toBe("localcode mcp add mcp-ssh npx @aiondadotcom/mcp-ssh");
  });

  it("does not match bash blocks inside longer text with other code blocks", () => {
    // Simulates model output with documentation containing code blocks
    const content = [
      "Based on the documentation, here is how to configure it:",
      "",
      '```json',
      '{ "mcpServers": { "ssh": {} } }',
      '```',
      "",
      "Let me install it now:",
      "",
      "```bash",
      "localcode mcp add mcp-ssh npx @aiondadotcom/mcp-ssh",
      "```",
    ].join("\n");
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments.command).toBe("localcode mcp add mcp-ssh npx @aiondadotcom/mcp-ssh");
  });

  it("falls back to $ prefix detection when no bash blocks", () => {
    const content = "Run this command:\n\n$ npm install\n$ npm run build";
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.arguments.command).toBe("npm install");
    expect(calls[1]?.arguments.command).toBe("npm run build");
  });

  it("falls back to > prefix detection when no bash blocks", () => {
    const content = "Try this:\n> ls -la";
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments.command).toBe("ls -la");
  });

  it("does not use fallback when bash block exists", () => {
    const content = "```bash\nnpm install\n```\n\n$ some other command";
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments.command).toBe("npm install");
  });

  it("returns empty for pure text with no commands", () => {
    const content = "The server is now installed and ready to use.";
    const calls = extractBashBlocks(content);
    expect(calls).toHaveLength(0);
  });

  it("all calls use mcp__local__bash as tool name", () => {
    const content = "```bash\nnpm install\ngit status\n```";
    const calls = extractBashBlocks(content);
    for (const call of calls) {
      expect(call.name).toBe("mcp__local__bash");
    }
  });
});
