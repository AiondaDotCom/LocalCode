import { describe, it, expect, beforeEach } from "vitest";
import { Permissions } from "../src/permissions.js";
import { PermissionLevel } from "../src/types.js";

describe("Permissions", () => {
  let permissions: Permissions;

  beforeEach(() => {
    permissions = new Permissions();
  });

  describe("default permissions", () => {
    it("should classify file_read as SAFE", () => {
      expect(permissions.getPermission("file_read")).toBe(PermissionLevel.SAFE);
    });

    it("should classify shell_exec as DANGEROUS", () => {
      expect(permissions.getPermission("shell_exec")).toBe(PermissionLevel.DANGEROUS);
    });

    it("should classify unknown tools as DANGEROUS", () => {
      expect(permissions.getPermission("unknown_tool")).toBe(PermissionLevel.DANGEROUS);
    });

    it("should return correct boolean checks", () => {
      expect(permissions.isSafe("file_read")).toBe(true);
      expect(permissions.isDangerous("shell_exec")).toBe(true);
      expect(permissions.isSafe("shell_exec")).toBe(false);
    });
  });

  describe("custom config", () => {
    it("should apply custom safe tools", () => {
      const custom = new Permissions({
        safe_auto_allow: ["shell_exec"],
        dangerous_confirm: [],
        blocked: ["file_delete"],
      });
      expect(custom.isSafe("shell_exec")).toBe(true);
      expect(custom.isBlocked("file_delete")).toBe(true);
    });
  });

  describe("setPermission", () => {
    it("should change permission level", () => {
      permissions.setPermission("file_read", PermissionLevel.BLOCKED);
      expect(permissions.isBlocked("file_read")).toBe(true);
    });
  });

  describe("requestPermission", () => {
    it("should auto-allow SAFE tools", async () => {
      expect(await permissions.requestPermission("file_read")).toBe(true);
    });

    it("should auto-deny BLOCKED tools", async () => {
      permissions.setPermission("dangerous_tool", PermissionLevel.BLOCKED);
      expect(await permissions.requestPermission("dangerous_tool")).toBe(false);
    });

    it("should auto-approve in auto_yes mode", async () => {
      permissions.setTestingMode("auto_yes");
      expect(await permissions.requestPermission("shell_exec")).toBe(true);
    });

    it("should auto-deny in auto_no mode", async () => {
      permissions.setTestingMode("auto_no");
      expect(await permissions.requestPermission("shell_exec")).toBe(false);
    });

    it("should skip all when dangerously-skip-permissions", async () => {
      permissions.setDangerouslySkipPermissions(true);
      expect(await permissions.requestPermission("shell_exec")).toBe(true);
      expect(await permissions.requestPermission("file_write")).toBe(true);
    });

    it("should still block BLOCKED even with skip-permissions", async () => {
      permissions.setDangerouslySkipPermissions(true);
      permissions.setPermission("evil_tool", PermissionLevel.BLOCKED);
      expect(await permissions.requestPermission("evil_tool")).toBe(false);
    });
  });

  describe("tool lists", () => {
    it("should list safe tools", () => {
      const safe = permissions.getSafeTools();
      expect(safe).toContain("file_read");
      expect(safe).toContain("grep_search");
      expect(safe).not.toContain("shell_exec");
    });

    it("should list dangerous tools", () => {
      const dangerous = permissions.getDangerousTools();
      expect(dangerous).toContain("shell_exec");
      expect(dangerous).toContain("file_write");
      expect(dangerous).not.toContain("file_read");
    });
  });

  describe("remembered permissions", () => {
    it("should reset remembered permissions", () => {
      permissions.resetRememberedPermissions();
      // Should not throw
      expect(true).toBe(true);
    });
  });
});
