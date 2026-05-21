"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@repo/database";
import { ticket, ticketMessage, user } from "@repo/database/schema";
import { sendTicketAdminNotification } from "../notifications";
import {
  addTicketMessageSchema,
  createTicketSchema,
  updateTicketStatusSchema,
} from "../schemas";
import { adminAction, protectedAction } from "../../safe-action";

const withTicketAction = (name: string) =>
  protectedAction.metadata({ action: `support.${name}` });
const withAdminTicketAction = (name: string) =>
  adminAction.metadata({ action: `support.admin.${name}` });

const unreadTicketSql = sql<boolean>`${ticket.lastAdminActivityAt} > ${ticket.userLastSeenAt}`.mapWith(
  Boolean
);
const unreadTicketCountSql = sql<number>`count(*) filter (where ${ticket.lastAdminActivityAt} > ${ticket.userLastSeenAt})`.mapWith(
  Number
);

// ============================================
// 用户端 Actions
// ============================================

/**
 * 创建工单
 *
 * 用户创建新的支持工单，同时添加第一条消息
 */
export const createTicketAction = withTicketAction("createTicket")
  .schema(createTicketSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    // 生成唯一 ID
    const ticketId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const now = new Date();

    // 创建工单
    await db.insert(ticket).values({
      id: ticketId,
      userId: ctx.userId,
      subject: data.subject,
      category: data.category,
      priority: data.priority,
      status: "open",
      userLastSeenAt: now,
      updatedAt: now,
    });

    // 创建初始消息
    await db.insert(ticketMessage).values({
      id: messageId,
      ticketId: ticketId,
      userId: ctx.userId,
      content: data.message,
      isAdminResponse: false,
    });

    await sendTicketAdminNotification({
      type: "created",
      ticketId,
      subject: data.subject,
      category: data.category,
      priority: data.priority,
      message: data.message,
      userName: ctx.user.name,
      userEmail: ctx.user.email,
    });

    // 刷新缓存
    revalidatePath("/dashboard/support");

    return {
      message: "工单创建成功",
      ticketId,
    };
  });

/**
 * 获取用户的工单列表
 */
export const getMyTicketsAction = withTicketAction("getMyTickets").action(
  async ({ ctx }) => {
    const tickets = await db
      .select({
        id: ticket.id,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        userLastSeenAt: ticket.userLastSeenAt,
        lastAdminActivityAt: ticket.lastAdminActivityAt,
        unread: unreadTicketSql,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      })
      .from(ticket)
      .where(eq(ticket.userId, ctx.userId))
      .orderBy(desc(ticket.createdAt));

    return { tickets };
  }
);

/**
 * 获取工单详情 (用户端)
 *
 * 只能查看自己的工单
 */
export const getTicketDetailAction = withTicketAction("getTicketDetail")
  .schema(addTicketMessageSchema.pick({ ticketId: true }))
  .action(async ({ parsedInput: { ticketId }, ctx }) => {
    // 获取工单信息
    const ticketResult = await db
      .select()
      .from(ticket)
      .where(and(eq(ticket.id, ticketId), eq(ticket.userId, ctx.userId)))
      .limit(1);

    const ticketData = ticketResult[0];
    if (!ticketData) {
      throw new Error("工单不存在或无权访问");
    }
    const now = new Date();

    await db
      .update(ticket)
      .set({ userLastSeenAt: now })
      .where(and(eq(ticket.id, ticketId), eq(ticket.userId, ctx.userId)));

    // 获取消息列表
    const messages = await db
      .select({
        id: ticketMessage.id,
        content: ticketMessage.content,
        isAdminResponse: ticketMessage.isAdminResponse,
        createdAt: ticketMessage.createdAt,
        user: {
          id: user.id,
          name: user.name,
          image: user.image,
        },
      })
      .from(ticketMessage)
      .leftJoin(user, eq(ticketMessage.userId, user.id))
      .where(eq(ticketMessage.ticketId, ticketId))
      .orderBy(ticketMessage.createdAt);

    return {
      ticket: { ...ticketData, userLastSeenAt: now },
      messages,
    };
  });

/**
 * 添加工单消息 (用户端)
 */
export const addTicketMessageAction = withTicketAction("addTicketMessage")
  .schema(addTicketMessageSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    // 验证工单属于当前用户
    const ticketResult = await db
      .select()
      .from(ticket)
      .where(and(eq(ticket.id, data.ticketId), eq(ticket.userId, ctx.userId)))
      .limit(1);

    const ticketData = ticketResult[0];
    if (!ticketData) {
      throw new Error("工单不存在或无权访问");
    }

    // 检查工单状态
    if (ticketData.status === "closed") {
      throw new Error("工单已关闭，无法添加新消息");
    }

    const now = new Date();

    // 添加消息
    await db.insert(ticketMessage).values({
      id: crypto.randomUUID(),
      ticketId: data.ticketId,
      userId: ctx.userId,
      content: data.content,
      isAdminResponse: false,
    });

    // 更新工单时间
    await db
      .update(ticket)
      .set({ updatedAt: now })
      .where(eq(ticket.id, data.ticketId));

    await sendTicketAdminNotification({
      type: "user_reply",
      ticketId: data.ticketId,
      subject: ticketData.subject,
      category: ticketData.category,
      priority: ticketData.priority,
      message: data.content,
      userName: ctx.user.name,
      userEmail: ctx.user.email,
    });

    // 刷新缓存
    revalidatePath(`/dashboard/support/${data.ticketId}`);
    revalidatePath("/dashboard/support");

    return {
      message: "消息发送成功",
    };
  });

// ============================================
// 管理员 Actions
// ============================================

/**
 * 获取所有工单列表 (管理员)
 */
export const getAllTicketsAction = withAdminTicketAction(
  "getAllTickets"
).action(async () => {
  const tickets = await db
    .select({
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      userLastSeenAt: ticket.userLastSeenAt,
      lastAdminActivityAt: ticket.lastAdminActivityAt,
      unread: unreadTicketSql,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(ticket)
    .leftJoin(user, eq(ticket.userId, user.id))
    .orderBy(desc(ticket.createdAt));

  return { tickets };
});

/**
 * 获取当前用户未读工单动态数量
 */
export const getMyUnreadTicketCountAction = withTicketAction(
  "getMyUnreadTicketCount"
).action(async ({ ctx }) => {
  const rows = await db
    .select({
      count: unreadTicketCountSql,
    })
    .from(ticket)
    .where(eq(ticket.userId, ctx.userId));

  return { count: rows[0]?.count ?? 0 };
});

/**
 * 获取工单详情 (管理员)
 *
 * 管理员可以查看任何工单
 */
export const getAdminTicketDetailAction = withAdminTicketAction(
  "getAdminTicketDetail"
)
  .schema(addTicketMessageSchema.pick({ ticketId: true }))
  .action(async ({ parsedInput: { ticketId } }) => {
    // 获取工单信息（包含用户信息）
    const ticketResult = await db
      .select({
        ticket: ticket,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
      })
      .from(ticket)
      .leftJoin(user, eq(ticket.userId, user.id))
      .where(eq(ticket.id, ticketId))
      .limit(1);

    const result = ticketResult[0];
    if (!result) {
      throw new Error("工单不存在");
    }

    // 获取消息列表
    const messages = await db
      .select({
        id: ticketMessage.id,
        content: ticketMessage.content,
        isAdminResponse: ticketMessage.isAdminResponse,
        createdAt: ticketMessage.createdAt,
        user: {
          id: user.id,
          name: user.name,
          image: user.image,
        },
      })
      .from(ticketMessage)
      .leftJoin(user, eq(ticketMessage.userId, user.id))
      .where(eq(ticketMessage.ticketId, ticketId))
      .orderBy(ticketMessage.createdAt);

    return {
      ticket: result.ticket,
      ticketUser: result.user,
      messages,
    };
  });

/**
 * 管理员回复工单
 */
export const adminReplyTicketAction = withAdminTicketAction("replyTicket")
  .schema(addTicketMessageSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    // 验证工单存在
    const ticketResult = await db
      .select()
      .from(ticket)
      .where(eq(ticket.id, data.ticketId))
      .limit(1);

    const ticketData = ticketResult[0];
    if (!ticketData) {
      throw new Error("工单不存在");
    }

    const now = new Date();

    // 添加管理员回复
    await db.insert(ticketMessage).values({
      id: crypto.randomUUID(),
      ticketId: data.ticketId,
      userId: ctx.userId,
      content: data.content,
      isAdminResponse: true,
    });

    // 如果工单是 open 状态，自动更新为 in_progress
    if (ticketData.status === "open") {
      await db
        .update(ticket)
        .set({
          status: "in_progress",
          lastAdminActivityAt: now,
          updatedAt: now,
        })
        .where(eq(ticket.id, data.ticketId));
    } else {
      await db
        .update(ticket)
        .set({ lastAdminActivityAt: now, updatedAt: now })
        .where(eq(ticket.id, data.ticketId));
    }

    // 刷新缓存
    revalidatePath(`/dashboard/support/${data.ticketId}`);
    revalidatePath("/dashboard/support");

    return {
      message: "回复成功",
    };
  });

/**
 * 更新工单状态 (管理员)
 */
export const updateTicketStatusAction = withAdminTicketAction(
  "updateTicketStatus"
)
  .schema(updateTicketStatusSchema)
  .action(async ({ parsedInput: data }) => {
    // 验证工单存在
    const ticketResult = await db
      .select()
      .from(ticket)
      .where(eq(ticket.id, data.ticketId))
      .limit(1);

    if (ticketResult.length === 0) {
      throw new Error("工单不存在");
    }

    const now = new Date();

    // 更新状态
    await db
      .update(ticket)
      .set({
        status: data.status,
        lastAdminActivityAt: now,
        updatedAt: now,
      })
      .where(eq(ticket.id, data.ticketId));

    // 刷新缓存
    revalidatePath(`/dashboard/support/${data.ticketId}`);
    revalidatePath("/dashboard/support");

    return {
      message: "状态更新成功",
    };
  });
