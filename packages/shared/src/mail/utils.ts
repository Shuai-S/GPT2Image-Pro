import { render } from "@react-email/render";
import type { ReactElement } from "react";
import {
  getEmailProvider,
  getDefaultFromEmail,
  getMailRuntimeConfigSnapshot,
  getResendClient,
  getSmtpTransporter,
} from "./client";
import { logger } from "../logger";

/**
 * 邮件发送工具
 *
 * 提供统一的邮件发送接口，支持开发环境模拟和生产环境发送
 */

// ============================================
// 类型定义
// ============================================

/**
 * 发送邮件参数
 */
export interface SendEmailParams {
  /** 收件人邮箱 (单个或数组) */
  to: string | string[];
  /** 邮件主题 */
  subject: string;
  /** React Email 组件 */
  react: ReactElement;
  /** 发件人地址 (可选，默认使用 DEFAULT_FROM_EMAIL) */
  from?: string;
  /** 抄送地址 */
  cc?: string | string[];
  /** 密送地址 */
  bcc?: string | string[];
  /** 回复地址 */
  replyTo?: string | string[];
  /** 强制发送 (开发环境下也发送真实邮件) */
  force?: boolean;
}

/**
 * 邮件发送结果
 */
export interface SendEmailResult {
  /** 是否成功 */
  success: boolean;
  /** 邮件服务返回的 ID (生产环境) */
  id?: string;
  /** 错误信息 */
  error?: string;
  /** 是否为模拟发送 (开发环境) */
  simulated?: boolean;
  /** 实际使用的发送通道 */
  provider?: "smtp" | "resend";
}

// ============================================
// 工具函数
// ============================================

/**
 * 判断是否为开发环境
 */
function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * 在控制台输出邮件预览信息 (开发环境)
 */
function logEmailPreview(params: SendEmailParams): void {
  const recipients = Array.isArray(params.to)
    ? params.to.join(", ")
    : params.to;
  const defaultFromEmail = getDefaultFromEmail();

  console.log(`\n${"=".repeat(60)}`);
  console.log("EMAIL PREVIEW (Development Mode)");
  console.log("=".repeat(60));
  console.log(`To:      ${recipients}`);
  console.log(`From:    ${params.from ?? defaultFromEmail}`);
  console.log(`Subject: ${params.subject}`);
  if (params.cc) {
    console.log(
      `CC:      ${Array.isArray(params.cc) ? params.cc.join(", ") : params.cc}`
    );
  }
  if (params.bcc) {
    console.log(
      `BCC:     ${Array.isArray(params.bcc) ? params.bcc.join(", ") : params.bcc}`
    );
  }
  if (params.replyTo) {
    console.log(
      `Reply:   ${Array.isArray(params.replyTo) ? params.replyTo.join(", ") : params.replyTo}`
    );
  }
  console.log("-".repeat(60));
  console.log("Set force: true to send real email in development");
  console.log(`${"=".repeat(60)}\n`);
}

function getAddressDomain(address: string) {
  const match = address.match(/@([^>\s]+)>?$/);
  return match?.[1]?.toLowerCase();
}

function getRecipientDomains(value: string | string[]) {
  const recipients = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      recipients
        .map((recipient) => getAddressDomain(recipient))
        .filter((domain): domain is string => Boolean(domain))
    )
  );
}

function getOptionalAddressDomains(value: string | string[] | undefined) {
  if (!value) return [];
  return getRecipientDomains(value);
}

function normalizeMailError(error: unknown) {
  if (!(error instanceof Error)) {
    return {
      message: "Unknown error",
    };
  }

  const details = error as Error & {
    code?: string;
    command?: string;
    response?: string;
    responseCode?: number;
    errno?: number;
    syscall?: string;
    address?: string;
    port?: number;
  };

  return {
    name: error.name,
    message: error.message,
    ...(details.code ? { code: details.code } : {}),
    ...(details.command ? { command: details.command } : {}),
    ...(details.response ? { response: details.response } : {}),
    ...(details.responseCode ? { responseCode: details.responseCode } : {}),
    ...(details.errno ? { errno: details.errno } : {}),
    ...(details.syscall ? { syscall: details.syscall } : {}),
    ...(details.address ? { address: details.address } : {}),
    ...(details.port ? { port: details.port } : {}),
  };
}

// ============================================
// 核心函数
// ============================================

/**
 * 发送邮件
 *
 * 主要特性:
 * - 开发环境默认只输出日志，不发送真实邮件
 * - 通过 force: true 可在开发环境发送真实邮件
 * - 生产环境始终发送真实邮件
 * - 完善的错误处理
 *
 * @example
 * ```ts
 * // 发送欢迎邮件
 * await sendEmail({
 *   to: "user@example.com",
 *   subject: "Welcome to GPT2IMAGE!",
 *   react: <WelcomeEmail name="John" dashboardUrl="..." />,
 * });
 *
 * // 开发环境强制发送
 * await sendEmail({
 *   to: "user@example.com",
 *   subject: "Test Email",
 *   react: <TestEmail />,
 *   force: true,
 * });
 * ```
 */
export async function sendEmail(
  params: SendEmailParams
): Promise<SendEmailResult> {
  const { to, subject, react, from, cc, bcc, replyTo, force = false } = params;

  // 开发环境且未强制发送 -> 模拟发送
  if (isDevelopment() && !force) {
    logEmailPreview(params);
    return {
      success: true,
      simulated: true,
    };
  }

  // 真实发送邮件
  const startedAt = Date.now();
  const defaultFromEmail = getDefaultFromEmail();
  const resolvedFrom = from ?? defaultFromEmail;
  const baseLogContext = {
    source: "mail.sendEmail",
    subject,
    fromDomain: getAddressDomain(resolvedFrom),
    toDomains: getRecipientDomains(to),
    ccDomains: getOptionalAddressDomains(cc),
    bccCount: Array.isArray(bcc) ? bcc.length : bcc ? 1 : 0,
    replyToDomains: getOptionalAddressDomains(replyTo),
    force,
  };

  try {
    const provider = getEmailProvider();
    const runtimeConfig = getMailRuntimeConfigSnapshot();

    if (provider === "smtp") {
      const transporter = getSmtpTransporter();
      const html = await render(react);
      const text = await render(react, { plainText: true });

      const info = await transporter.sendMail({
        from: resolvedFrom,
        to,
        subject,
        html,
        text,
        ...(cc ? { cc } : {}),
        ...(bcc ? { bcc } : {}),
        ...(replyTo ? { replyTo } : {}),
      });

      logger.info(
        {
          ...baseLogContext,
          provider,
          runtimeConfig,
          durationMs: Date.now() - startedAt,
          messageId: info.messageId,
          acceptedCount: info.accepted?.length ?? 0,
          rejectedCount: info.rejected?.length ?? 0,
          pendingCount: info.pending?.length ?? 0,
          response: info.response,
        },
        "Email sent"
      );

      return {
        success: true,
        id: info.messageId,
        provider,
      };
    }

    const resend = getResendClient();
    // 构建邮件选项 (避免传递 undefined 值以满足 exactOptionalPropertyTypes)
    const emailOptions: Parameters<typeof resend.emails.send>[0] = {
      from: resolvedFrom,
      to: Array.isArray(to) ? to : [to],
      subject,
      react,
    };

    // 仅在有值时添加可选字段
    if (cc) {
      emailOptions.cc = Array.isArray(cc) ? cc : [cc];
    }
    if (bcc) {
      emailOptions.bcc = Array.isArray(bcc) ? bcc : [bcc];
    }
    if (replyTo) {
      emailOptions.replyTo = Array.isArray(replyTo) ? replyTo : [replyTo];
    }

    const { data, error } = await resend.emails.send(emailOptions);

    if (error) {
      logger.error(
        {
          ...baseLogContext,
          provider,
          runtimeConfig,
          durationMs: Date.now() - startedAt,
          error: {
            name: error.name,
            message: error.message,
          },
        },
        "Email sending failed"
      );
      return {
        success: false,
        error: error.message,
      };
    }

    logger.info(
      {
        ...baseLogContext,
        provider,
        runtimeConfig,
        durationMs: Date.now() - startedAt,
        messageId: data?.id,
      },
      "Email sent"
    );

    return {
      success: true,
      id: data?.id,
      provider,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error(
      {
        ...baseLogContext,
        runtimeConfig: getMailRuntimeConfigSnapshot(),
        durationMs: Date.now() - startedAt,
        error: normalizeMailError(error),
      },
      "Email sending error"
    );
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * 批量发送邮件
 *
 * 向多个收件人发送相同内容的邮件
 * 每个收件人会收到独立的邮件
 *
 * @example
 * ```ts
 * const results = await sendBulkEmail({
 *   recipients: ["a@example.com", "b@example.com"],
 *   subject: "Newsletter",
 *   react: <NewsletterEmail />,
 * });
 * ```
 */
export async function sendBulkEmail(params: {
  recipients: string[];
  subject: string;
  react: ReactElement;
  from?: string;
  force?: boolean;
}): Promise<{ sent: number; failed: number; results: SendEmailResult[] }> {
  const { recipients, ...emailParams } = params;

  const results: SendEmailResult[] = [];
  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const result = await sendEmail({
      to: recipient,
      ...emailParams,
    });

    results.push(result);

    if (result.success) {
      sent++;
    } else {
      failed++;
    }
  }

  return { sent, failed, results };
}
