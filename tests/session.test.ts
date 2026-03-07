import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Session } from "../src/session.js";

describe("Session", () => {
  let session: Session;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localcode-test-"));
    session = new Session(tempDir, 10);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("messages", () => {
    it("should add messages", () => {
      session.addMessage("user", "hello");
      session.addMessage("assistant", "hi there");
      expect(session.getHistory()).toHaveLength(2);
    });

    it("should include timestamp", () => {
      session.addMessage("user", "test");
      const msg = session.getHistory()[0];
      expect(msg?.timestamp).toBeDefined();
    });

    it("should enforce max history", () => {
      for (let i = 0; i < 15; i++) {
        session.addMessage("user", `msg ${String(i)}`);
      }
      expect(session.getHistory()).toHaveLength(10);
    });

    it("should return message count", () => {
      session.addMessage("user", "a");
      session.addMessage("assistant", "b");
      expect(session.getMessageCount()).toBe(2);
    });
  });

  describe("chat format", () => {
    it("should prepend system prompt", () => {
      session.addMessage("user", "hello");
      const messages = session.getMessagesForChat("You are helpful");
      expect(messages[0]?.role).toBe("system");
      expect(messages[0]?.content).toBe("You are helpful");
      expect(messages[1]?.role).toBe("user");
    });
  });

  describe("save/load", () => {
    it("should save and load session", () => {
      session.addMessage("user", "test message");
      session.addMessage("assistant", "response");
      session.saveSession("test-session");

      const loaded = new Session(tempDir);
      expect(loaded.loadSession("test-session")).toBe(true);
      expect(loaded.getHistory()).toHaveLength(2);
      expect(loaded.getHistory()[0]?.content).toBe("test message");
    });

    it("should return false for missing session", () => {
      expect(session.loadSession("nonexistent")).toBe(false);
    });

    it("should list sessions", () => {
      session.saveSession("alpha");
      session.saveSession("beta");
      const list = session.listSessions();
      expect(list).toContain("alpha");
      expect(list).toContain("beta");
    });

    it("should delete session", () => {
      session.saveSession("to-delete");
      expect(session.deleteSession("to-delete")).toBe(true);
      expect(session.deleteSession("to-delete")).toBe(false);
    });
  });

  describe("clear", () => {
    it("should clear history", () => {
      session.addMessage("user", "test");
      session.clearSession();
      expect(session.getHistory()).toHaveLength(0);
      expect(session.getCurrentSession()).toBeNull();
    });
  });

  describe("truncate", () => {
    it("should remove oldest message pairs", () => {
      for (let i = 0; i < 8; i++) {
        session.addMessage("user", `q${String(i)}`);
      }
      session.truncateHistory(2);
      expect(session.getHistory()).toHaveLength(4);
    });
  });

  describe("compress", () => {
    it("should compress history with summarizer", async () => {
      for (let i = 0; i < 8; i++) {
        session.addMessage("user", `question ${String(i)}`);
      }

      const summarizer = async () => "Summary of conversation";
      const result = await session.compressHistory(summarizer, 4);
      expect(result).toBe(true);
      expect(session.getHistory()[0]?.content).toContain("Summary");
    });

    it("should fallback to truncation on error", async () => {
      for (let i = 0; i < 8; i++) {
        session.addMessage("user", `msg ${String(i)}`);
      }

      const failingSummarizer = async () => {
        throw new Error("fail");
      };
      const result = await session.compressHistory(failingSummarizer, 4);
      expect(result).toBe(false);
    });
  });
});
