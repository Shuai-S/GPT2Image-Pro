/*
 * 文件职责：Web 容器启动入口，修正运行期挂载目录权限并降权启动应用。
 * 使用方：Dockerfile.web 的 runner 镜像。
 * 关键依赖：node:fs 处理目录权限，node:child_process 启动 Next.js standalone。
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const DEFAULT_APP_UID = 1001;
const DEFAULT_APP_GID = 1001;
const SIGNAL_EXIT_CODES = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGQUIT: 131,
  SIGTERM: 143,
};

/**
 * 读取正整数环境变量。
 *
 * @param {string} name - 环境变量名。
 * @param {number} fallback - 未设置或非法时使用的默认值。
 * @returns {number} 可用于 setuid/setgid 的数字 ID。
 * @sideEffects 无。
 * @throws 不抛出；非法输入会回退默认值。
 */
function readPositiveIntegerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const appUid = readPositiveIntegerEnv("GPT2IMAGE_RUNTIME_UID", DEFAULT_APP_UID);
const appGid = readPositiveIntegerEnv("GPT2IMAGE_RUNTIME_GID", DEFAULT_APP_GID);

/**
 * 确保目录存在，并在 root 启动阶段把目录所有权交给运行用户。
 *
 * @param {string} dirPath - 容器内需要应用写入的目录。
 * @param {number} mode - 目录权限，仅修正顶层目录以避免大 storage 启动变慢。
 * @returns {void}
 * @sideEffects 创建目录、调整目录属主和权限。
 * @throws 当目录无法创建或 root 无法修正权限时抛出，阻止容器静默半启动。
 */
function ensureWritableDirectory(dirPath, mode) {
  fs.mkdirSync(dirPath, { recursive: true, mode });

  if (typeof process.getuid === "function" && process.getuid() === 0) {
    fs.chownSync(dirPath, appUid, appGid);
    fs.chmodSync(dirPath, mode);
  }
}

/**
 * 将当前 entrypoint 进程降权到应用用户。
 *
 * @returns {void}
 * @sideEffects 修改当前进程的用户、用户组和附加组。
 * @throws 当容器以 root 运行但无法降权时抛出，避免业务进程以 root 继续运行。
 */
function dropPrivileges() {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    return;
  }

  if (typeof process.setgroups === "function") {
    process.setgroups([appGid]);
  }
  process.setgid(appGid);
  process.setuid(appUid);
}

/**
 * 启动实际应用进程并转发常见终止信号。
 *
 * @param {string} command - 要执行的命令。
 * @param {string[]} args - 命令参数。
 * @returns {void}
 * @sideEffects 创建子进程，并根据子进程退出状态结束 entrypoint。
 * @throws 不主动抛出；spawn 错误会以 1 退出。
 */
function runApplication(command, args) {
  const child = spawn(command, args, {
    env: process.env,
    stdio: "inherit",
  });

  for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
    process.on(signal, () => {
      if (!child.killed) {
        child.kill(signal);
      }
    });
  }

  child.on("error", (error) => {
    console.error(`[GPT2IMAGE] Failed to start web process: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal && signal in SIGNAL_EXIT_CODES) {
      process.exit(SIGNAL_EXIT_CODES[signal]);
    }

    process.exit(code ?? 0);
  });
}

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("[GPT2IMAGE] Missing web process command.");
  process.exit(64);
}

ensureWritableDirectory("/app/storage", 0o755);
ensureWritableDirectory("/app/.gpt2image", 0o700);
ensureWritableDirectory("/app/apps/web/.next/cache", 0o755);
dropPrivileges();
runApplication(command, args);
