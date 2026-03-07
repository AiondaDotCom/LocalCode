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

  // ~/.claude/CLAUDE.md
  const userFile = path.join(os.homedir(), ".claude", "CLAUDE.md");
  const ctx = readContextFile(userFile, "user");
  if (ctx !== null) results.push(ctx);

  return results;
}

function loadAncestorContext(cwd: string): ContextFile[] {
  const results: ContextFile[] = [];
  const home = os.homedir();

  let dir = path.dirname(cwd);
  while (dir !== path.dirname(dir) && dir !== home) {
    const filePath = path.join(dir, "CLAUDE.md");
    const ctx = readContextFile(filePath, "ancestor");
    if (ctx !== null) results.push(ctx);

    const altPath = path.join(dir, ".claude", "CLAUDE.md");
    const altCtx = readContextFile(altPath, "ancestor");
    if (altCtx !== null) results.push(altCtx);

    dir = path.dirname(dir);
  }

  return results.reverse();
}

function loadProjectContext(cwd: string): ContextFile[] {
  const results: ContextFile[] = [];

  // ./CLAUDE.md
  const projectFile = path.join(cwd, "CLAUDE.md");
  const ctx = readContextFile(projectFile, "project");
  if (ctx !== null) results.push(ctx);

  // ./.claude/CLAUDE.md (alternative location)
  const altFile = path.join(cwd, ".claude", "CLAUDE.md");
  const altCtx = readContextFile(altFile, "project");
  if (altCtx !== null) results.push(altCtx);

  return results;
}

function loadLocalContext(cwd: string): ContextFile[] {
  const results: ContextFile[] = [];

  // ./CLAUDE.local.md
  const localFile = path.join(cwd, "CLAUDE.local.md");
  const ctx = readContextFile(localFile, "local");
  if (ctx !== null) results.push(ctx);

  return results;
}

function loadRulesContext(cwd: string): ContextFile[] {
  const results: ContextFile[] = [];
  const rulesDir = path.join(cwd, ".claude", "rules");

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
  const claudeFile = path.join(dir, "CLAUDE.md");
  return readContextFile(claudeFile, "subdir");
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
