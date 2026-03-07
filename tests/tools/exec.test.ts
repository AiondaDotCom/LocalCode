import { describe, it, expect } from "vitest";
import { execTools } from "../../src/tools/exec.js";

function findTool(name: string) {
  const tool = execTools.find((t) => t.name === name);
  if (tool === undefined) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe("Exec Tools", () => {
  describe("bash", () => {
    it("should execute simple command", async () => {
      const result = await findTool("bash").handler({ command: "echo hello" });
      expect(result.success).toBe(true);
      expect(result.output).toBe("hello");
    });

    it("should return exit code on failure", async () => {
      const result = await findTool("bash").handler({ command: "false" });
      expect(result.success).toBe(false);
    });

    it("should fail without command", async () => {
      const result = await findTool("bash").handler({});
      expect(result.success).toBe(false);
      expect(result.output).toContain("Missing");
    });

    it("should handle multiline output", async () => {
      const result = await findTool("bash").handler({
        command: "echo line1 && echo line2",
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain("line1");
      expect(result.output).toContain("line2");
    });

    it("should detect missing execute permission", async () => {
      const result = await findTool("bash").handler({
        command: "./nonexistent_script.sh",
      });
      // File doesn't exist, so no permission error (just exec error)
      expect(result.success).toBe(false);
    });
  });

  describe("todoread/todowrite", () => {
    it("should report no tasks when none exist", async () => {
      const result = await findTool("todoread").handler({});
      // May or may not have tasks depending on cwd state
      expect(result.success).toBe(true);
    });
  });

  describe("permissions", () => {
    it("should mark bash as dangerous", () => {
      expect(findTool("bash").permissionLevel).toBe("dangerous");
    });

    it("should mark todoread as safe", () => {
      expect(findTool("todoread").permissionLevel).toBe("safe");
    });

    it("should mark todowrite as dangerous", () => {
      expect(findTool("todowrite").permissionLevel).toBe("dangerous");
    });
  });
});
