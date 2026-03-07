import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MLX_MODEL = "nightmedia/Qwen3.5-35B-A3B-Text-qx64-hi-mlx";
const MLX_LOG = "/tmp/localcode-mlx-server.log";

function findPythonWithMlxLm(): string | null {
  // 1. Check if there's already a running mlx_lm.server — use its python
  try {
    const psOutput = execSync("ps aux 2>/dev/null", { encoding: "utf-8" });
    const mlxLine = psOutput.split("\n").find((l) => l.includes("mlx_lm.server") && !l.includes("grep"));
    if (mlxLine !== undefined) {
      const match = /(\S*python\S*)\s+-m\s+mlx_lm/.exec(mlxLine);
      if (match?.[1] !== undefined && fs.existsSync(match[1])) {
        return match[1];
      }
    }
  } catch {
    // ignore
  }

  // 2. Try python3/python in PATH
  for (const cmd of ["python3", "python"]) {
    try {
      const check = execSync(
        `${cmd} -c "import mlx_lm; print('ok')" 2>/dev/null`,
        { encoding: "utf-8" },
      ).trim();
      if (check === "ok") {
        return execSync(`which ${cmd}`, { encoding: "utf-8" }).trim();
      }
    } catch {
      // not available or mlx_lm not installed
    }
  }

  // 3. Try mlx_lm.server in PATH
  try {
    const mlxBin = execSync("which mlx_lm.server 2>/dev/null", { encoding: "utf-8" }).trim();
    if (mlxBin !== "") {
      const python = mlxBin.replace(/\/bin\/mlx_lm\.server$/, "/bin/python3");
      if (fs.existsSync(python)) return python;
    }
  } catch {
    // ignore
  }

  // 4. Search common venv locations
  const home = process.env["HOME"] ?? "";
  const searchDirs = [
    path.join(home, ".venv"),
    path.join(home, "venv"),
  ];
  // Also check all immediate subdirs of ~/dev/ for .venv
  const devDir = path.join(home, "dev");
  if (fs.existsSync(devDir)) {
    try {
      const dirs = fs.readdirSync(devDir, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory()) {
          searchDirs.push(path.join(devDir, d.name, ".venv"));
          searchDirs.push(path.join(devDir, d.name, "venv"));
        }
      }
    } catch {
      // ignore
    }
  }

  for (const venv of searchDirs) {
    const python = path.join(venv, "bin", "python3");
    if (!fs.existsSync(python)) continue;
    try {
      const check = execSync(
        `"${python}" -c "import mlx_lm; print('ok')" 2>/dev/null`,
        { encoding: "utf-8" },
      ).trim();
      if (check === "ok") return python;
    } catch {
      // mlx_lm not in this venv
    }
  }

  return null;
}

function getChatTemplate(): string {
  // Shipped with localcode-ts in config/
  const bundled = path.join(__dirname, "..", "config", "qwen3_chat_template.jinja");
  if (fs.existsSync(bundled)) {
    return fs.readFileSync(bundled, "utf-8");
  }

  // Fallback: user override in ~/.localcode/
  const home = process.env["HOME"] ?? "";
  const userTemplate = path.join(home, ".localcode", "chat_template.jinja");
  if (fs.existsSync(userTemplate)) {
    return fs.readFileSync(userTemplate, "utf-8");
  }

  throw new Error(
    "Qwen3 chat template not found. Expected at config/qwen3_chat_template.jinja",
  );
}

function waitForServer(port: number, timeoutSeconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    let elapsed = 0;
    const interval = setInterval(() => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/v1/models",
          method: "GET",
          timeout: 2000,
        },
        (res) => {
          res.resume();
          if (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300) {
            clearInterval(interval);
            resolve(true);
          }
        },
      );
      req.on("error", () => {
        // not ready yet
      });
      req.on("timeout", () => {
        req.destroy();
      });
      req.end();

      elapsed++;
      if (elapsed >= timeoutSeconds) {
        clearInterval(interval);
        resolve(false);
      }
    }, 1000);
  });
}

export async function startMLXServer(port: number): Promise<boolean> {
  const python = findPythonWithMlxLm();
  if (python === null) {
    process.stderr.write(
      "\x1b[31mCannot find Python with mlx-lm installed.\x1b[0m\n" +
      "\x1b[90mInstall: pip install mlx-lm\x1b[0m\n",
    );
    return false;
  }

  let template: string;
  try {
    template = getChatTemplate();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\x1b[31m${msg}\x1b[0m\n`);
    return false;
  }

  process.stderr.write(`\x1b[33mStarting MLX server (${MLX_MODEL})...\x1b[0m\n`);

  const args = [
    "-m", "mlx_lm.server",
    "--model", MLX_MODEL,
    "--port", String(port),
    "--host", "127.0.0.1",
    "--chat-template", template,
    "--chat-template-args", '{"enable_thinking":false}',
  ];

  const logFd = fs.openSync(MLX_LOG, "w");
  const child = spawn(python, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  process.stderr.write("\x1b[90mWaiting for MLX server to load model (this may take a moment)...\x1b[0m\n");

  const ready = await waitForServer(port, 120);
  if (ready) {
    process.stderr.write("\x1b[32mMLX server ready\x1b[0m\n");
  } else {
    process.stderr.write(`\x1b[31mMLX server did not start. Check logs: ${MLX_LOG}\x1b[0m\n`);
  }
  return ready;
}

export function stopMLXServer(): boolean {
  try {
    execSync("pkill -f mlx_lm.server 2>/dev/null || true", { encoding: "utf-8" });
    process.stderr.write("\x1b[33mMLX server stopped\x1b[0m\n");
    return true;
  } catch {
    return false;
  }
}
