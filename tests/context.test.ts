import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadContextFiles, buildContextPrompt } from "../src/context.js";

describe("Context (CLAUDE.md)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localcode-ctx-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("loadContextFiles", () => {
    it("should load CLAUDE.md from project root", () => {
      fs.writeFileSync(path.join(tempDir, "CLAUDE.md"), "Project instructions");
      const files = loadContextFiles(tempDir);
      const project = files.find((f) => f.scope === "project");
      expect(project).toBeDefined();
      expect(project?.content).toBe("Project instructions");
    });

    it("should load .claude/CLAUDE.md alternative", () => {
      fs.mkdirSync(path.join(tempDir, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, ".claude", "CLAUDE.md"),
        "Alt instructions",
      );
      const files = loadContextFiles(tempDir);
      const project = files.find((f) => f.scope === "project");
      expect(project).toBeDefined();
      expect(project?.content).toBe("Alt instructions");
    });

    it("should load CLAUDE.local.md", () => {
      fs.writeFileSync(
        path.join(tempDir, "CLAUDE.local.md"),
        "Local preferences",
      );
      const files = loadContextFiles(tempDir);
      const local = files.find((f) => f.scope === "local");
      expect(local).toBeDefined();
      expect(local?.content).toBe("Local preferences");
    });

    it("should load rules from .claude/rules/", () => {
      const rulesDir = path.join(tempDir, ".claude", "rules");
      fs.mkdirSync(rulesDir, { recursive: true });
      fs.writeFileSync(path.join(rulesDir, "style.md"), "Use tabs");
      const files = loadContextFiles(tempDir);
      const rules = files.find((f) => f.scope === "rules");
      expect(rules).toBeDefined();
      expect(rules?.content).toBe("Use tabs");
    });

    it("should return empty array when no files exist", () => {
      const files = loadContextFiles(tempDir);
      // Filter out user-level files that might exist on the system
      const projectFiles = files.filter(
        (f) => f.scope === "project" || f.scope === "local" || f.scope === "rules",
      );
      expect(projectFiles).toHaveLength(0);
    });

    it("should truncate files over 200 lines", () => {
      const longContent = Array.from({ length: 300 }, (_, i) => `Line ${String(i + 1)}`).join("\n");
      fs.writeFileSync(path.join(tempDir, "CLAUDE.md"), longContent);
      const files = loadContextFiles(tempDir);
      const project = files.find((f) => f.scope === "project");
      expect(project?.content).toContain("truncated");
    });
  });

  describe("buildContextPrompt", () => {
    it("should format files into prompt", () => {
      const files = [
        { path: "/test/CLAUDE.md", content: "Be helpful", scope: "project" as const },
      ];
      const prompt = buildContextPrompt(files);
      expect(prompt).toContain("Project & User Instructions");
      expect(prompt).toContain("Be helpful");
      expect(prompt).toContain("[project]");
    });

    it("should return empty string for no files", () => {
      expect(buildContextPrompt([])).toBe("");
    });

    it("should include multiple files", () => {
      const files = [
        { path: "/a", content: "First", scope: "user" as const },
        { path: "/b", content: "Second", scope: "project" as const },
      ];
      const prompt = buildContextPrompt(files);
      expect(prompt).toContain("First");
      expect(prompt).toContain("Second");
    });
  });
});
