import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileTools } from "../../src/tools/file.js";

function findTool(name: string) {
  const tool = fileTools.find((t) => t.name === name);
  if (tool === undefined) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe("File Tools", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localcode-file-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("read", () => {
    it("should read file contents", async () => {
      const file = path.join(tempDir, "test.txt");
      fs.writeFileSync(file, "hello world");
      const result = await findTool("read").handler({ file });
      expect(result.success).toBe(true);
      expect(result.output).toBe("hello world");
    });

    it("should fail on missing file", async () => {
      const result = await findTool("read").handler({ file: "/nonexistent" });
      expect(result.success).toBe(false);
    });

    it("should fail without arguments", async () => {
      const result = await findTool("read").handler({});
      expect(result.success).toBe(false);
      expect(result.output).toContain("Missing");
    });
  });

  describe("write", () => {
    it("should write content to file", async () => {
      const file = path.join(tempDir, "out.txt");
      const result = await findTool("write").handler({ file, content: "hello" });
      expect(result.success).toBe(true);
      expect(fs.readFileSync(file, "utf-8")).toBe("hello\n");
    });

    it("should create parent directories", async () => {
      const file = path.join(tempDir, "sub", "dir", "file.txt");
      const result = await findTool("write").handler({ file, content: "nested" });
      expect(result.success).toBe(true);
      expect(fs.existsSync(file)).toBe(true);
    });
  });

  describe("edit", () => {
    it("should replace text in file", async () => {
      const file = path.join(tempDir, "edit.txt");
      fs.writeFileSync(file, "hello world");
      const result = await findTool("edit").handler({
        file,
        old: "world",
        new: "rust",
      });
      expect(result.success).toBe(true);
      expect(fs.readFileSync(file, "utf-8")).toBe("hello rust");
    });

    it("should fail if old text not found", async () => {
      const file = path.join(tempDir, "edit.txt");
      fs.writeFileSync(file, "hello world");
      const result = await findTool("edit").handler({
        file,
        old: "nonexistent",
        new: "replacement",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("grep", () => {
    it("should find matching lines with line numbers", async () => {
      const file = path.join(tempDir, "search.txt");
      fs.writeFileSync(file, "alpha\nbeta\nalpha again\n");
      const result = await findTool("grep").handler({
        pattern: "alpha",
        file,
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain("1:");
      expect(result.output).toContain("3:");
    });

    it("should report no matches", async () => {
      const file = path.join(tempDir, "search.txt");
      fs.writeFileSync(file, "hello world");
      const result = await findTool("grep").handler({
        pattern: "xyz",
        file,
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain("No matches");
    });
  });

  describe("list", () => {
    it("should list directory contents sorted", async () => {
      fs.writeFileSync(path.join(tempDir, "b.txt"), "");
      fs.writeFileSync(path.join(tempDir, "a.txt"), "");
      fs.mkdirSync(path.join(tempDir, "subdir"));

      const result = await findTool("list").handler({ path: tempDir });
      expect(result.success).toBe(true);
      expect(result.output).toContain("a.txt");
      expect(result.output).toContain("b.txt");
      expect(result.output).toContain("subdir/");
    });
  });

  describe("permissions", () => {
    it("should mark read as safe", () => {
      expect(findTool("read").permissionLevel).toBe("safe");
    });

    it("should mark write as dangerous", () => {
      expect(findTool("write").permissionLevel).toBe("dangerous");
    });

    it("should mark edit as dangerous", () => {
      expect(findTool("edit").permissionLevel).toBe("dangerous");
    });

    it("should mark grep as safe", () => {
      expect(findTool("grep").permissionLevel).toBe("safe");
    });
  });
});
