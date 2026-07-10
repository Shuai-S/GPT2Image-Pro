/**
 * Lighthouse CI 登录态浏览器准备脚本。
 *
 * 使用方：lighthouserc.cjs 在审计 Dashboard URL 前调用。脚本读取应用启动期写入的
 * 一次性本地超管凭据，通过真实登录表单建立 Better Auth Cookie，不创建测试后门。
 */

const { readFileSync } = require("node:fs");

let authenticated = false;

/**
 * 从 0600 启动凭据文件读取登录字段。
 *
 * @returns {{ email: string, password: string }} 已校验的邮箱和一次性密码。
 * @throws 路径缺失、文件不可读或字段不完整时失败，LHCI 不得降级成匿名审计。
 */
function readBootstrapCredentials() {
  const filePath = process.env.GPT2IMAGE_BOOTSTRAP_CREDENTIALS_PATH;
  if (!filePath) {
    throw new Error("GPT2IMAGE_BOOTSTRAP_CREDENTIALS_PATH is required");
  }
  const fields = new Map();
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    fields.set(line.slice(0, separator), line.slice(separator + 1));
  }
  const email = fields.get("email");
  const password = fields.get("password");
  if (!email || !password) {
    throw new Error("Bootstrap credentials file is incomplete");
  }
  return { email, password };
}

/**
 * 在第一个受保护 URL 前执行一次真实邮箱密码登录。
 *
 * @param {import("puppeteer-core").Browser} browser LHCI 复用的浏览器实例。
 * @param {{ url: string }} context 当前即将审计的 URL。
 * @returns {Promise<void>} 登录 Cookie 建立后完成；公开 URL 或已登录时直接返回。
 * @sideEffects 打开临时页面、提交登录表单并在默认浏览器上下文写会话 Cookie。
 */
module.exports = async function authenticateLighthouse(browser, context) {
  const target = new URL(context.url);
  if (authenticated || !target.pathname.includes("/dashboard")) return;

  const credentials = readBootstrapCredentials();
  const page = await browser.newPage();
  try {
    await page.goto(`${target.origin}/en/sign-in`, {
      waitUntil: "networkidle0",
      timeout: 30_000,
    });
    await page.waitForSelector("#email", { timeout: 10_000 });
    await page.type("#email", credentials.email);
    await page.type("#password", credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(
      () => !window.location.pathname.includes("/sign-in"),
      { timeout: 30_000 }
    );
    authenticated = true;
  } finally {
    await page.close();
  }
};
