import type { Transporter } from "nodemailer";
import { createTransport } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { Resend } from "resend";
import {
  getProcessSettingBoolean,
  getProcessSettingString,
} from "../system-settings";

/**
 * 邮件客户端
 *
 * 支持 SMTP 和 Resend 两种发送通道。生产环境推荐显式配置
 * EMAIL_PROVIDER=smtp 或 EMAIL_PROVIDER=resend。
 */

export type EmailProvider = "smtp" | "resend";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export interface MailRuntimeConfigSnapshot {
  provider: EmailProvider;
  fromDomain?: string;
  smtpConfigured: boolean;
  resendConfigured: boolean;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    userDomain?: string;
  };
}

export function getSmtpConfig(): SmtpConfig | null {
  const host = getProcessSettingString("SMTP_HOST");
  const user = getProcessSettingString("SMTP_USER");
  const pass = getProcessSettingString("SMTP_PASS");

  if (!host || !user || !pass) {
    return null;
  }

  const port = Number.parseInt(
    getProcessSettingString("SMTP_PORT") ?? "465",
    10
  );
  const resolvedPort = Number.isFinite(port) ? port : 465;

  return {
    host,
    port: resolvedPort,
    secure: getProcessSettingBoolean("SMTP_SECURE", resolvedPort === 465),
    user,
    pass,
  };
}

export function isSmtpConfigured() {
  return Boolean(getSmtpConfig());
}

export function isResendConfigured() {
  return Boolean(getProcessSettingString("RESEND_API_KEY"));
}

export function isEmailConfigured() {
  return isSmtpConfigured() || isResendConfigured();
}

export function getEmailProvider(): EmailProvider {
  const configuredProvider =
    getProcessSettingString("EMAIL_PROVIDER")?.toLowerCase();

  if (configuredProvider === "smtp" || configuredProvider === "resend") {
    return configuredProvider;
  }

  if (isSmtpConfigured()) {
    return "smtp";
  }

  return "resend";
}

function getEmailDomain(value: string | undefined) {
  const match = value?.match(/@([^>\s]+)>?$/);
  return match?.[1]?.toLowerCase();
}

function getSmtpConfigFingerprint(config: SmtpConfig) {
  return JSON.stringify({
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    pass: config.pass,
  });
}

export function getDefaultFromEmail() {
  return (
    getProcessSettingString("EMAIL_FROM") ?? "GPT2IMAGE <noreply@gpt2image.com>"
  );
}

export function getMailRuntimeConfigSnapshot(): MailRuntimeConfigSnapshot {
  const smtpConfig = getSmtpConfig();
  const emailFrom = getProcessSettingString("EMAIL_FROM");
  const fromDomain = getEmailDomain(emailFrom);
  const snapshot: MailRuntimeConfigSnapshot = {
    provider: getEmailProvider(),
    smtpConfigured: Boolean(smtpConfig),
    resendConfigured: isResendConfigured(),
  };

  if (fromDomain) {
    snapshot.fromDomain = fromDomain;
  }

  if (smtpConfig) {
    const userDomain = getEmailDomain(smtpConfig.user);
    snapshot.smtp = {
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
    };
    if (userDomain) {
      snapshot.smtp.userDomain = userDomain;
    }
  }

  return snapshot;
}

/**
 * 获取 Resend 客户端实例
 *
 * 使用懒加载模式，只在需要时创建实例
 */
function createResendClient() {
  const apiKey = getProcessSettingString("RESEND_API_KEY");

  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }

  return new Resend(apiKey);
}

/**
 * Resend 客户端单例
 */
let resendClient: Resend | null = null;
let resendClientApiKey: string | null = null;

/**
 * 获取 Resend 客户端
 *
 * 单例模式，确保只创建一个客户端实例
 */
export function getResendClient(): Resend {
  const apiKey = getProcessSettingString("RESEND_API_KEY") ?? null;
  if (!resendClient || resendClientApiKey !== apiKey) {
    resendClient = createResendClient();
    resendClientApiKey = apiKey;
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
let smtpTransporterFingerprint: string | null = null;

export function getSmtpTransporter(): Transporter<SMTPTransport.SentMessageInfo> {
  const config = getSmtpConfig();

  if (!config) {
    throw new Error(
      "SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_SECURE."
    );
  }

  const fingerprint = getSmtpConfigFingerprint(config);
  if (!smtpTransporter || smtpTransporterFingerprint !== fingerprint) {
    smtpTransporter?.close();
    smtpTransporter = createSmtpTransporter();
    smtpTransporterFingerprint = fingerprint;
  }

  return smtpTransporter;
}

/**
 * 默认发件人地址
 *
 * 可以通过环境变量 EMAIL_FROM 配置
 * 格式: "Name <email@domain.com>"
 */
export const DEFAULT_FROM_EMAIL = getDefaultFromEmail();
