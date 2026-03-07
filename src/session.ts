import * as fs from "node:fs";
import * as path from "node:path";
import type { Message, SessionData } from "./types.js";

export class Session {
  private history: Message[] = [];
  private sessionDir: string;
  private currentSession: string | null = null;
  private maxHistory: number;

  constructor(sessionDir: string, maxHistory = 100) {
    this.sessionDir = sessionDir;
    this.maxHistory = maxHistory;

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
  }

  addMessage(role: Message["role"], content: string): void {
    this.history.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });

    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  getHistory(): Message[] {
    return [...this.history];
  }

  getMessagesForChat(systemPrompt: string): Message[] {
    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      ...this.history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];
    return messages;
  }

  clearSession(): void {
    this.history = [];
    this.currentSession = null;
  }

  saveSession(name: string): void {
    const data: SessionData = {
      name,
      messages: this.history,
      created_at: this.history[0]?.timestamp ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const filePath = path.join(this.sessionDir, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    this.currentSession = name;
  }

  loadSession(name: string): boolean {
    const filePath = path.join(this.sessionDir, `${name}.json`);
    if (!fs.existsSync(filePath)) return false;

    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content) as SessionData;
    this.history = data.messages;
    this.currentSession = name;
    return true;
  }

  listSessions(): string[] {
    if (!fs.existsSync(this.sessionDir)) return [];

    return fs
      .readdirSync(this.sessionDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  }

  deleteSession(name: string): boolean {
    const filePath = path.join(this.sessionDir, `${name}.json`);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  getCurrentSession(): string | null {
    return this.currentSession;
  }

  getMessageCount(): number {
    return this.history.length;
  }

  truncateHistory(removePairs = 3): void {
    const removeCount = removePairs * 2;
    if (this.history.length > removeCount) {
      this.history = this.history.slice(removeCount);
    }
  }

  async compressHistory(
    summarizer: (messages: Message[]) => Promise<string>,
    compressCount = 6,
  ): Promise<boolean> {
    if (this.history.length < compressCount + 2) return false;

    const toCompress = this.history.slice(0, compressCount);
    const remaining = this.history.slice(compressCount);

    try {
      const summary = await summarizer(toCompress);
      this.history = [
        {
          role: "system",
          content: `[Previous conversation summary: ${summary}]`,
          timestamp: new Date().toISOString(),
        },
        ...remaining,
      ];
      return true;
    } catch {
      this.truncateHistory();
      return false;
    }
  }
}
