import { getRuntimeBrandingConfig } from "../config/branding";
import { getRuntimeSiteUrl } from "../config/site-runtime";
import { logError, logger } from "../logger";
import { SupportTicketNotificationEmail } from "../mail/templates";
import { sendEmail } from "../mail/utils";
import { getRuntimeSettingString } from "../system-settings";
import { ticketCategories, ticketPriorities } from "./schemas";

type TicketNotificationType = "created" | "user_reply";

interface TicketNotificationInput {
  type: TicketNotificationType;
  ticketId: string;
  subject: string;
  category: string;
  priority: string;
  message: string;
  userName?: string | null;
  userEmail?: string | null;
}

function parseRecipients(value?: string) {
  return (value ?? "")
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function truncatePreview(value: string, maxLength = 600) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

function optionLabel(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string
) {
  return options.find((option) => option.value === value)?.label ?? value;
}

async function getTicketUrl(ticketId: string) {
  const baseUrl = await getRuntimeSiteUrl();
  return `${baseUrl}/dashboard/support/${ticketId}`;
}

export async function sendTicketAdminNotification(
  input: TicketNotificationInput
) {
  const recipients = parseRecipients(
    await getRuntimeSettingString("SUPPORT_TICKET_NOTIFICATION_EMAIL")
  );
  if (recipients.length === 0) return;

  const title =
    input.type === "created" ? "有新的用户工单" : "用户追加了工单回复";
  const [ticketUrl, branding] = await Promise.all([
    getTicketUrl(input.ticketId),
    getRuntimeBrandingConfig(),
  ]);

  try {
    const result = await sendEmail({
      to: recipients,
      subject: `[${branding.name}] ${title}: ${input.subject}`,
      react: SupportTicketNotificationEmail({
        title,
        subject: input.subject,
        ticketUrl,
        appName: branding.name,
        userName: input.userName,
        userEmail: input.userEmail,
        category: optionLabel(ticketCategories, input.category),
        priority: optionLabel(ticketPriorities, input.priority),
        messagePreview: truncatePreview(input.message),
      }),
      ...(input.userEmail ? { replyTo: input.userEmail } : {}),
    });

    if (!result.success) {
      logger.warn(
        {
          ticketId: input.ticketId,
          recipients,
          error: result.error,
        },
        "Failed to send support ticket notification email"
      );
    }
  } catch (error) {
    logError(error, {
      source: "support-ticket-notification",
      ticketId: input.ticketId,
    });
  }
}
