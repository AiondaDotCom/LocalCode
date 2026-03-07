import { describe, it, expect, beforeEach } from "vitest";
import * as path from "node:path";
import { Config } from "../src/config.js";

const CONFIG_PATH = path.join(__dirname, "..", "config", "default.yaml");

describe("Config", () => {
  let config: Config;

  beforeEach(() => {
    config = new Config(CONFIG_PATH);
  });

  describe("loading", () => {
    it("should load default config", () => {
      expect(config.getBackend()).toBe("mlx");
    });

    it("should throw on missing config", () => {
      expect(() => new Config("/nonexistent/config.yaml")).toThrow();
    });
  });

  describe("get/set", () => {
    it("should get nested values with dot notation", () => {
      expect(config.get<string>("mlx.host")).toBe("127.0.0.1");
      expect(config.get<number>("mlx.port")).toBe(8000);
    });

    it("should return undefined for missing paths", () => {
      expect(config.get("nonexistent.path")).toBeUndefined();
    });

    it("should set values with dot notation", () => {
      config.set("mlx.host", "192.168.1.1");
      expect(config.get<string>("mlx.host")).toBe("192.168.1.1");
    });
  });

  describe("backend", () => {
    it("should return MLX config by default", () => {
      const bc = config.getBackendConfig();
      expect(bc.host).toBe("127.0.0.1");
      expect(bc.port).toBe(8000);
    });

    it("should return default model", () => {
      const bc = config.getBackendConfig();
      expect(bc.default_model).toContain("Qwen3.5");
    });

    it("should switch to ollama", () => {
      config.set("backend", "ollama");
      expect(config.getBackend()).toBe("ollama");
      const bc = config.getBackendConfig();
      expect(bc.port).toBe(11434);
    });
  });

  describe("version", () => {
    it("should return version string", () => {
      expect(config.getVersion()).toBe("2.0.0");
    });
  });

  describe("validation", () => {
    it("should validate correct config", () => {
      const errors = config.validate();
      expect(errors).toHaveLength(0);
    });
  });

  describe("directories", () => {
    it("should return localcode dir path", () => {
      expect(config.getLocalcodeDir()).toContain(".localcode");
    });

    it("should return sessions dir path", () => {
      expect(config.getSessionsDir()).toContain("sessions");
    });
  });

  describe("model persistence", () => {
    it("should save and load model", () => {
      config.saveLastModel("test-model");
      expect(config.loadLastModel()).toBe("test-model");
    });

    it("should trim whitespace from model name", () => {
      config.saveLastModel("  test-model  \n");
      expect(config.loadLastModel()).toBe("test-model");
    });
  });
});
