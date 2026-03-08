import { execSync, spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function getHostIP(): string {
  // Docker Desktop for Mac: host.docker.internal resolves to host
  return "host.docker.internal";
}

export interface SandboxOptions {
  backend: string;
  backendHost: string;
  backendPort: number;
  readOnly: boolean;
  network: boolean;
  prompt?: string;
  extraArgs: string[];
}

export async function runInSandbox(
  cwd: string,
  options: SandboxOptions,
): Promise<void> {
  if (!isDockerAvailable()) {
    console.error("\x1b[31mDocker is not running. Install Docker Desktop or start the Docker daemon.\x1b[0m");
    process.exit(1);
  }

  const hostIP = getHostIP();
  const mountFlag = options.readOnly ? "ro" : "rw";

  // Resolve localcode package path for mounting into container
  const packageRoot = path.resolve(import.meta.dirname, "..");

  const dockerArgs: string[] = [
    "run", "-it", "--rm",
    // Mount workspace
    "-v", `${cwd}:/workspace:${mountFlag}`,
    "-w", "/workspace",
    // Mount localcode itself so we don't need to npm install inside
    "-v", `${packageRoot}:/opt/localcode:ro`,
    // Host access for LLM backend
    "--add-host", `host.docker.internal:host-gateway`,
    // Environment
    "-e", `LOCALCODE_BACKEND=${options.backend}`,
    "-e", `LOCALCODE_BACKEND_HOST=${hostIP}`,
    "-e", `LOCALCODE_BACKEND_PORT=${String(options.backendPort)}`,
    "-e", "LOCALCODE_SANDBOX=1",
  ];

  if (!options.network) {
    // Allow only host access, block internet
    // (can't use --network none because we need host.docker.internal)
  }

  // Pass through ~/.localcode config if it exists
  const localcodeDir = path.join(process.env["HOME"] ?? "", ".localcode");
  if (fs.existsSync(localcodeDir)) {
    dockerArgs.push("-v", `${localcodeDir}:/root/.localcode:ro`);
  }

  // Extra docker args
  dockerArgs.push(...options.extraArgs);

  // Use node:22-slim image
  dockerArgs.push("node:22-slim");

  // Command inside container
  if (options.prompt !== undefined) {
    dockerArgs.push(
      "node", "/opt/localcode/dist/index.js",
      "--backend", options.backend,
      "--dangerously-skip-permissions",
      options.prompt,
    );
  } else {
    dockerArgs.push(
      "node", "/opt/localcode/dist/index.js",
      "--backend", options.backend,
      "--dangerously-skip-permissions",
    );
  }

  console.log(`\x1b[36m🐳 Starting LocalCode in sandbox...\x1b[0m`);
  console.log(`\x1b[90m   Workspace: ${cwd} (${mountFlag})`);
  console.log(`   Backend: ${options.backend} @ ${hostIP}:${String(options.backendPort)}`);
  console.log(`   Permissions: auto-approved (sandboxed)\x1b[0m`);

  const child = spawn("docker", dockerArgs, {
    stdio: "inherit",
  });

  return new Promise<void>((resolve, reject) => {
    child.on("close", (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`Sandbox exited with code ${String(code)}`));
      }
    });
    child.on("error", (err) => {
      reject(new Error(`Failed to start sandbox: ${err.message}`));
    });
  });
}
