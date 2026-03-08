import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ContextFile, ContextScope } from "./types.js";

const MAX_LINES = 200;

function readContextFile(
  filePath: string,
  scope: ContextScope,
): ContextFile | null {
  if (!fs.existsSync(filePath)) return null;

  try {
    let content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    if (lines.length > MAX_LINES) {
      content = lines.slice(0, MAX_LINES).join("\n");
      content += `\n\n[... truncated at ${String(MAX_LINES)} lines]`;
    }
    return { path: filePath, content, scope };
  } catch {
    return null;
  }
}

function loadUserContext(): ContextFile[] {
  const results: ContextFile[] = [];

  // ~/.localcode/LOCALCODE.md (preferred) → ~/.claude/CLAUDE.md (fallback)
  const localcodeUser = path.join(os.homedir(), ".localcode", "LOCALCODE.md");
  const claudeUser = path.join(os.homedir(), ".claude", "CLAUDE.md");
  const ctx = readContextFile(localcodeUser, "user") ?? readContextFile(claudeUser, "user");
  if (ctx !== null) results.push(ctx);

  return results;
}

function loadAncestorContext(cwd: string): ContextFile[] {
  const results: ContextFile[] = [];
  const home = os.homedir();

  let dir = path.dirname(cwd);
  while (dir !== path.dirname(dir) && dir !== home) {
    // LOCALCODE.md preferred, fallback to CLAUDE.md
    const lcFile = path.join(dir, "LOCALCODE.md");
    const clFile = path.join(dir, "CLAUDE.md");
    const ctx = readContextFile(lcFile, "ancestor") ?? readContextFile(clFile, "ancestor");
    if (ctx !== null) results.push(ctx);

    const lcAlt = path.join(dir, ".localcode", "LOCALCODE.md");
    const clAlt = path.join(dir, ".claude", "CLAUDE.md");
    const altCtx = readContextFile(lcAlt, "ancestor") ?? readContextFile(clAlt, "ancestor");
    if (altCtx !== null) results.push(altCtx);

    dir = path.dirname(dir);
  }

  return results.reverse();
}

function loadProjectContext(cwd: string): ContextFile[] {
  const results: ContextFile[] = [];

  // LOCALCODE.md preferred, fallback to CLAUDE.md
  const lcFile = path.join(cwd, "LOCALCODE.md");
  const clFile = path.join(cwd, "CLAUDE.md");
  const ctx = readContextFile(lcFile, "project") ?? readContextFile(clFile, "project");
  if (ctx !== null) results.push(ctx);

  // .localcode/ preferred, fallback to .claude/
  const lcAlt = path.join(cwd, ".localcode", "LOCALCODE.md");
  const clAlt = path.join(cwd, ".claude", "CLAUDE.md");
  const altCtx = readContextFile(lcAlt, "project") ?? readContextFile(clAlt, "project");
  if (altCtx !== null) results.push(altCtx);

  return results;
}

function loadLocalContext(cwd: string): ContextFile[] {
  const results: ContextFile[] = [];

  // LOCALCODE.local.md preferred, fallback to CLAUDE.local.md
  const lcFile = path.join(cwd, "LOCALCODE.local.md");
  const clFile = path.join(cwd, "CLAUDE.local.md");
  const ctx = readContextFile(lcFile, "local") ?? readContextFile(clFile, "local");
  if (ctx !== null) results.push(ctx);

  return results;
}

function loadRulesContext(cwd: string): ContextFile[] {
  const results: ContextFile[] = [];
  // .localcode/rules preferred, fallback to .claude/rules
  const lcRulesDir = path.join(cwd, ".localcode", "rules");
  const clRulesDir = path.join(cwd, ".claude", "rules");
  const rulesDir = fs.existsSync(lcRulesDir) ? lcRulesDir : clRulesDir;

  if (!fs.existsSync(rulesDir)) return results;

  try {
    const files = fs.readdirSync(rulesDir, { recursive: true });
    for (const file of files) {
      const fileName = String(file);
      if (!fileName.endsWith(".md")) continue;

      const filePath = path.join(rulesDir, fileName);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      const ctx = readContextFile(filePath, "rules");
      if (ctx !== null) results.push(ctx);
    }
  } catch {
    // ignore errors reading rules directory
  }

  return results;
}

export function loadContextFiles(cwd: string): ContextFile[] {
  return [
    ...loadUserContext(),
    ...loadAncestorContext(cwd),
    ...loadProjectContext(cwd),
    ...loadLocalContext(cwd),
    ...loadRulesContext(cwd),
  ];
}

export function loadSubdirContext(filePath: string): ContextFile | null {
  const dir = path.dirname(filePath);
  const lcFile = path.join(dir, "LOCALCODE.md");
  const clFile = path.join(dir, "CLAUDE.md");
  return readContextFile(lcFile, "subdir") ?? readContextFile(clFile, "subdir");
}

export function generateInitContent(cwd: string): string {
  const projectName = path.basename(cwd);
  return `# ${projectName}

## Project Overview

<!-- Describe your project here -->

## Tech Stack

<!-- e.g. TypeScript, Node.js, React -->

## Project Structure

<!-- Key directories and their purpose -->

## Development

\`\`\`bash
# Install dependencies
# npm install

# Run tests
# npm test

# Build
# npm run build
\`\`\`

## Conventions

<!-- Coding style, naming conventions, patterns to follow -->

## Important Notes

<!-- Anything the AI agent should know when working on this project -->
`;
}

export function buildContextPrompt(files: ContextFile[]): string {
  if (files.length === 0) return "";

  const sections = files.map((f) => {
    const label = `[${f.scope}] ${f.path}`;
    return `--- ${label} ---\n${f.content}`;
  });

  return (
    "# Project & User Instructions\n\n" +
    sections.join("\n\n") +
    "\n\n# End Instructions\n"
  );
}
