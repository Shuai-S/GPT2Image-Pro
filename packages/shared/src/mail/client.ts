import type { Transporter } from "nodemailer";
import { createTransport } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { Resend } from "resend";

/**
 * 邮件客户端
 *
 * 支持 SMTP 和 Resend 两种发送通道。生产环境推荐显式配置
 * EMAIL_PROVIDER=smtp 或 EMAIL_PROVIDER=resend。
 */

export type EmailProvider = "smtp" | "resend";

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  const port = Number.parseInt(process.env.SMTP_PORT ?? "465", 10);
  const resolvedPort = Number.isFinite(port) ? port : 465;

  return {
    host,
    port: resolvedPort,
    secure: parseBoolean(process.env.SMTP_SECURE, resolvedPort === 465),
    user,
    pass,
  };
}

export function isSmtpConfigured() {
  return Boolean(getSmtpConfig());
}

export function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export function isEmailConfigured() {
  return isSmtpConfigured() || isResendConfigured();
}

export function getEmailProvider(): EmailProvider {
  const configuredProvider = process.env.EMAIL_PROVIDER?.toLowerCase();

  if (configuredProvider === "smtp" || configuredProvider === "resend") {
    return configuredProvider;
  }

  if (isSmtpConfigured()) {
    return "smtp";
  }

  return "resend";
}

/**
 * 获取 Resend 客户端实例
 *
 * 使用懒加载模式，只在需要时创建实例
 */
function createResendClient() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }

  return new Resend(apiKey);
}

/**
 * Resend 客户端单例
 */
let resendClient: Resend | null = null;

/**
 * 获取 Resend 客户端
 *
 * 单例模式，确保只创建一个客户端实例
 */
export function getResendClient(): Resend {
  if (!resendClient) {
    resendClient = createResendClient();
  }
  return resendClient;
}

function createSmtpTransporter() {
  const config = getSmtpConfig();

  if (!config) {
    throw new Error(
      "SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_SECURE."
    );
  }

  const options: SMTPTransport.Options = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  };

  return createTransport(options);
}

let smtpTransporter: Transporter<SMTPTransport.SentMessageInfo> | null = null;

export function getSmtpTransporter(): Transporter<SMTPTransport.SentMessageInfo> {
  if (!smtpTransporter) {
    smtpTransporter = createSmtpTransporter();
  }

  return smtpTransporter;
}

/**
 * 默认发件人地址
 *
 * 可以通过环境变量 EMAIL_FROM 配置
 * 格式: "Name <email@domain.com>"
 */
export const DEFAULT_FROM_EMAIL =
  process.env.EMAIL_FROM ?? "GPT2IMAGE <noreply@gpt2image.com>";
