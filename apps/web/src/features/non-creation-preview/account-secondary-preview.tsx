"use client";

// 账户中心次级页面原型。覆盖公告、工单、个人资料、安全与账户停用场景。

import {
  AlertTriangle,
  FileText,
  MessageSquareText,
  Monitor,
  Plus,
  Send,
  Smartphone,
  Ticket,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import {
  type AnnouncementRow,
  accountSessions,
  announcements,
  type SessionRow,
  type SupportTicketRow,
  supportTickets,
} from "./account-mock-data";
import styles from "./account-preview.module.css";
import {
  type AccountNotice,
  DialogShell,
  EmptyState,
  PageHeading,
  StatusText,
} from "./account-preview-shared";

/**
 * 渲染公告列表与 Markdown 文档阅读视图。
 *
 * @returns 用户打开具体公告后才改变本地未读状态的主从布局。
 * @sideEffects 仅在当前原型会话中记录已读公告。
 */
export function AnnouncementsPage({
  unreadIds,
  onRead,
}: {
  unreadIds: string[];
  onRead: (announcementId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = announcements.find((item) => item.id === selectedId) ?? null;

  /**
   * 打开公告并将这一条标记为本地已读。
   *
   * @param announcement 选中的模拟公告。
   * @sideEffects 更新当前页面选中项与已读集合，不批量处理其他公告。
   */
  const openAnnouncement = (announcement: AnnouncementRow) => {
    setSelectedId(announcement.id);
    onRead(announcement.id);
  };

  return (
    <section>
      <PageHeading
        eyebrow="服务"
        title="公告"
        description="查看平台维护、能力更新与账户相关的系统通知。"
      />
      <div className={styles.masterDetail}>
        <div className={styles.masterList}>
          {announcements.map((announcement) => {
            const unread = unreadIds.includes(announcement.id);
            return (
              <button
                type="button"
                key={announcement.id}
                data-active={selectedId === announcement.id}
                onClick={() => openAnnouncement(announcement)}
              >
                <span className={styles.masterItemTopline}>
                  <StatusText status={announcement.severity} />
                  {unread && <span className={styles.unreadDot}>未读</span>}
                </span>
                <strong>{announcement.title}</strong>
                <p>{announcement.summary}</p>
                <time>{announcement.publishedAt}</time>
              </button>
            );
          })}
        </div>
        <div className={styles.detailPane}>
          {selected ? (
            <MarkdownAnnouncementPreview announcement={selected} />
          ) : (
            <EmptyState
              icon={FileText}
              title="选择一则公告"
              description="打开具体内容后，这一则公告才会标记为已读。"
              compact
            />
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * 用可信静态结构展示 Markdown 公告的目标排版能力。
 *
 * @param props.announcement 当前选中的模拟公告。
 * @returns 标题、段落、列表、引用、表格、代码与安全链接的阅读视图。
 * @sideEffects 无；不解析字符串、不允许原始 HTML，也不加载外部内容。
 */
function MarkdownAnnouncementPreview({
  announcement,
}: {
  announcement: AnnouncementRow;
}) {
  return (
    <article className={styles.markdownDocument}>
      <span className={styles.sectionLabel}>系统公告</span>
      <h2>{announcement.title}</h2>
      <time>{announcement.publishedAt}</time>
      {announcement.body.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}

      <h3>本次通知包含</h3>
      <ul>
        <li>生效范围与预计时间</li>
        <li>任务和积分处理边界</li>
        <li>恢复后的用户操作说明</li>
      </ul>

      <blockquote>{announcement.summary}</blockquote>

      <h3>状态摘要</h3>
      <div className={styles.markdownTable}>
        <table>
          <thead>
            <tr>
              <th>项目</th>
              <th>状态</th>
              <th>影响</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>公告</td>
              <td>已发布</td>
              <td>{announcement.severity}</td>
            </tr>
            <tr>
              <td>用户数据</td>
              <td>受保护</td>
              <td>不会删除</td>
            </tr>
          </tbody>
        </table>
      </div>

      <pre>
        <code>{`announcement_id: ${announcement.id}\nstatus: published`}</code>
      </pre>
      <p>
        后续进展将在
        <a
          href="https://status.gpt2image.example"
          target="_blank"
          rel="noreferrer"
        >
          平台状态页
        </a>
        同步更新。
      </p>
    </article>
  );
}

/**
 * 渲染用户自己的工单列表、会话详情和新建工单模拟。
 *
 * @returns 适合桌面与手机的工单主从视图。
 * @sideEffects 回复和新建只写入组件本地状态，不发送邮件或服务端请求。
 */
export function SupportPage({
  unreadIds,
  onRead,
}: {
  unreadIds: string[];
  onRead: (ticketId: string) => void;
}) {
  const [tickets, setTickets] = useState<SupportTicketRow[]>(supportTickets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [creating, setCreating] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? null;

  /**
   * 打开指定工单并清除这一条的本地未读状态。
   *
   * @param ticketId 工单标识。
   * @sideEffects 更新当前会话选择，并通知账户侧栏刷新未读数量。
   */
  const openTicket = (ticketId: string) => {
    setSelectedId(ticketId);
    onRead(ticketId);
  };

  /**
   * 向未关闭的模拟工单追加用户回复。
   *
   * @param event 回复表单事件。
   * @sideEffects 只修改组件内工单数组；空内容或已关闭工单不提交。
   */
  const submitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = composer.trim();
    if (!content || !selected || selected.status === "已关闭") return;
    setTickets((current) =>
      current.map((ticket) =>
        ticket.id === selected.id
          ? {
              ...ticket,
              updatedAt: "刚刚",
              messages: [
                ...ticket.messages,
                {
                  id: `MSG-PREVIEW-${ticket.messages.length + 1}`,
                  author: "你" as const,
                  sentAt: "刚刚",
                  content,
                },
              ],
            }
          : ticket
      )
    );
    setComposer("");
  };

  /**
   * 创建一条新的本地模拟工单并立即打开。
   *
   * @param event 新建工单表单事件。
   * @sideEffects 只追加本地记录；标题或正文为空时保持表单不变。
   */
  const createTicket = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const subject = newSubject.trim();
    const content = newMessage.trim();
    if (!subject || !content) return;
    const ticket: SupportTicketRow = {
      id: "SUP-PREVIEW",
      subject,
      status: "待处理",
      updatedAt: "刚刚",
      unread: false,
      messages: [
        {
          id: "MSG-PREVIEW-1",
          author: "你",
          sentAt: "刚刚",
          content,
        },
      ],
    };
    setTickets((current) => [ticket, ...current]);
    setSelectedId(ticket.id);
    setCreating(false);
    setNewSubject("");
    setNewMessage("");
  };

  return (
    <section>
      <PageHeading
        eyebrow="服务"
        title="支持工单"
        description="查看自己的工单，在未关闭的会话中继续回复。"
        action={
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => setCreating(true)}
          >
            <Plus size={14} aria-hidden="true" />
            新建工单
          </button>
        }
      />
      <div className={styles.supportLayout}>
        <div className={styles.ticketList}>
          {tickets.map((ticket) => (
            <button
              type="button"
              key={ticket.id}
              data-active={selectedId === ticket.id}
              onClick={() => openTicket(ticket.id)}
            >
              <span>
                <Ticket size={15} aria-hidden="true" />
                <StatusText status={ticket.status} />
              </span>
              <strong>{ticket.subject}</strong>
              <small>
                {ticket.id} · {ticket.updatedAt}
              </small>
              {unreadIds.includes(ticket.id) && (
                <span className={styles.unreadDot}>有新回复</span>
              )}
            </button>
          ))}
        </div>
        <div className={styles.conversationPane}>
          {selected ? (
            <>
              <header>
                <div>
                  <span className={styles.sectionLabel}>{selected.id}</span>
                  <h2>{selected.subject}</h2>
                </div>
                <StatusText status={selected.status} />
              </header>
              <div className={styles.messages}>
                {selected.messages.map((message) => (
                  <article key={message.id} data-author={message.author}>
                    <span>
                      {message.author}
                      <time>{message.sentAt}</time>
                    </span>
                    <p>{message.content}</p>
                  </article>
                ))}
              </div>
              <form className={styles.replyComposer} onSubmit={submitReply}>
                <textarea
                  aria-label="回复工单"
                  placeholder={
                    selected.status === "已关闭"
                      ? "已关闭工单不能继续回复"
                      : "补充问题或回复支持团队"
                  }
                  disabled={selected.status === "已关闭"}
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                />
                <button
                  type="submit"
                  className={styles.iconButton}
                  aria-label="发送回复"
                  title="发送"
                  disabled={selected.status === "已关闭" || !composer.trim()}
                >
                  <Send size={15} aria-hidden="true" />
                </button>
              </form>
            </>
          ) : (
            <EmptyState
              icon={MessageSquareText}
              title="选择一个工单"
              description="工单内容会显示在这里。"
              compact
            />
          )}
        </div>
      </div>

      {creating && (
        <DialogShell
          title="新建支持工单"
          description="这是本地原型，不会向支持团队发送消息。"
          onClose={() => setCreating(false)}
        >
          <form className={styles.dialogForm} onSubmit={createTicket}>
            <label>
              <span>问题主题</span>
              <input
                required
                value={newSubject}
                onChange={(event) => setNewSubject(event.target.value)}
              />
            </label>
            <label>
              <span>问题说明</span>
              <textarea
                required
                rows={5}
                value={newMessage}
                onChange={(event) => setNewMessage(event.target.value)}
              />
            </label>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setCreating(false)}
              >
                取消
              </button>
              <button type="submit" className={styles.primaryButton}>
                创建模拟工单
              </button>
            </div>
          </form>
        </DialogShell>
      )}
    </section>
  );
}

/**
 * 渲染个人资料表单。
 *
 * @param props.onNotice 保存后的全局反馈函数。
 * @returns 名称、头像和语言的精简首版设置。
 * @sideEffects 提交只触发本地模拟成功提示。
 */
export function ProfilePage({
  onNotice,
}: {
  onNotice: (notice: AccountNotice) => void;
}) {
  const [name, setName] = useState("赵思");
  const [language, setLanguage] = useState("zh-CN");

  /**
   * 模拟保存个人资料。
   *
   * @param event 资料表单事件。
   * @sideEffects 阻止真实提交并显示本地结果。
   */
  const submitProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onNotice({ tone: "success", text: "个人资料已在原型中保存。" });
  };

  return (
    <section>
      <PageHeading
        eyebrow="账户"
        title="个人资料"
        description="管理公开名称、头像和界面语言。"
      />
      <form className={styles.settingsForm} onSubmit={submitProfile}>
        <section className={styles.settingsSection}>
          <div>
            <h2>头像</h2>
            <p>用于账户菜单和支持工单中的身份识别。</p>
          </div>
          <div className={styles.avatarEditor}>
            <span className={styles.largeAvatar}>ZS</span>
            <button type="button" className={styles.secondaryButton}>
              更换头像
            </button>
          </div>
        </section>
        <section className={styles.settingsSection}>
          <div>
            <h2>基本资料</h2>
            <p>邮箱由认证账户管理，当前页面只读展示。</p>
          </div>
          <div className={styles.formFields}>
            <label>
              <span>名称</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              <span>邮箱</span>
              <input value="zhao.si@example.com" readOnly />
            </label>
            <label>
              <span>界面语言</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
              </select>
            </label>
          </div>
        </section>
        <div className={styles.formFooter}>
          <span>模拟保存，不会修改真实账户。</span>
          <button type="submit" className={styles.primaryButton}>
            保存资料
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * 渲染修改密码和会话管理页面。
 *
 * @param props.onNotice 安全操作后的全局反馈函数。
 * @returns 首版安全设置与可撤销的其他设备会话列表。
 * @sideEffects 密码提交和会话撤销只改变本地状态。
 */
export function SecurityPage({
  onNotice,
}: {
  onNotice: (notice: AccountNotice) => void;
}) {
  const [sessions, setSessions] = useState<SessionRow[]>(accountSessions);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");

  /**
   * 模拟修改当前用户密码。
   *
   * @param event 密码表单事件。
   * @sideEffects 清空输入并显示结果；密码不会离开组件。
   */
  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentPassword || nextPassword.length < 8) return;
    setCurrentPassword("");
    setNextPassword("");
    onNotice({ tone: "success", text: "密码已在原型中更新。" });
  };

  /**
   * 从原型列表撤销指定的其他设备会话。
   *
   * @param sessionId 会话标识。
   * @sideEffects 删除本地会话并显示结果；当前会话不可撤销。
   */
  const revokeSession = (sessionId: string) => {
    setSessions((current) =>
      current.filter((session) => session.id !== sessionId)
    );
    onNotice({ tone: "success", text: "其他设备会话已在原型中撤销。" });
  };

  return (
    <section>
      <PageHeading
        eyebrow="账户"
        title="安全"
        description="修改密码并管理已登录设备。"
      />
      <div className={styles.settingsForm}>
        <section className={styles.settingsSection}>
          <div>
            <h2>修改密码</h2>
            <p>新密码至少 8 个字符，本原型不会提交密码内容。</p>
          </div>
          <form className={styles.formFields} onSubmit={submitPassword}>
            <label>
              <span>当前密码</span>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              <span>新密码</span>
              <input
                type="password"
                autoComplete="new-password"
                value={nextPassword}
                onChange={(event) => setNextPassword(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={!currentPassword || nextPassword.length < 8}
            >
              更新密码
            </button>
          </form>
        </section>
        <section className={styles.settingsSection}>
          <div>
            <h2>登录会话</h2>
            <p>撤销不再使用的设备，当前设备保持登录。</p>
          </div>
          <div className={styles.sessionList}>
            {sessions.map((session) => (
              <div key={session.id}>
                <span className={styles.sessionIcon}>
                  {session.device.includes("iPad") ? (
                    <Smartphone size={16} aria-hidden="true" />
                  ) : (
                    <Monitor size={16} aria-hidden="true" />
                  )}
                </span>
                <span>
                  <strong>{session.device}</strong>
                  <small>
                    {session.location} · {session.lastActive}
                  </small>
                </span>
                {session.current ? (
                  <StatusText status="当前" />
                ) : (
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => revokeSession(session.id)}
                  >
                    撤销
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

/**
 * 渲染数据保留说明和账户停用入口。
 *
 * @param props.onNotice 停用模拟完成后的全局反馈函数。
 * @returns 不误导为删除数据的账户停用页面。
 * @sideEffects 确认后只显示本地结果，不撤销真实会话或禁用账户。
 */
export function DataAndAccountPage({
  onNotice,
}: {
  onNotice: (notice: AccountNotice) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <section>
      <PageHeading
        eyebrow="账户"
        title="数据与账户"
        description="查看数据保留边界并管理账户状态。"
      />
      <section className={styles.accountDataSection}>
        <div>
          <span className={styles.sectionLabel}>账户数据</span>
          <h2>停用不会删除数据</h2>
          <p>
            停用后将立即禁止登录并撤销全部现有会话。账户资料、作品、画布、
            工单和业务记录仍会保留。
          </p>
        </div>
        <dl>
          <div>
            <dt>登录</dt>
            <dd>立即禁止</dd>
          </div>
          <div>
            <dt>现有会话</dt>
            <dd>全部撤销</dd>
          </div>
          <div>
            <dt>套餐与积分</dt>
            <dd>按原时间自然到期</dd>
          </div>
          <div>
            <dt>账户数据</dt>
            <dd>完整保留</dd>
          </div>
        </dl>
      </section>
      <div className={styles.dangerZone}>
        <div>
          <AlertTriangle size={17} aria-hidden="true" />
          <span>
            <strong>停用账户</strong>
            <small>恢复账户需要联系支持团队，由超级管理员核验后处理。</small>
          </span>
        </div>
        <button
          type="button"
          className={styles.dangerButton}
          onClick={() => setDialogOpen(true)}
        >
          停用账户
        </button>
      </div>

      {dialogOpen && (
        <DeactivateAccountDialog
          onClose={() => setDialogOpen(false)}
          onConfirm={() => {
            setDialogOpen(false);
            onNotice({
              tone: "info",
              text: "账户停用已在原型中模拟，真实账户仍可正常使用。",
            });
          }}
        />
      )}
    </section>
  );
}

/**
 * 渲染账户停用的高风险确认层。
 *
 * @param props 关闭与确认回调。
 * @returns 要求输入指定文本并再次说明数据保留事实的对话框。
 * @sideEffects 确认只触发父组件的模拟结果。
 */
function DeactivateAccountDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");

  return (
    <DialogShell
      title="停用账户"
      description="停用后禁止登录并撤销现有会话，但不会删除任何账户数据。"
      onClose={onClose}
    >
      <div className={styles.dangerExplanation}>
        <AlertTriangle size={18} aria-hidden="true" />
        <p>
          套餐与积分仍会按原时间自然到期。恢复时长不补偿，需要联系支持团队核验。
        </p>
      </div>
      <label className={styles.confirmationInput}>
        <span>
          输入 <strong>停用账户</strong> 以确认
        </span>
        <input
          autoComplete="off"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      <div className={styles.dialogActions}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onClose}
        >
          取消
        </button>
        <button
          type="button"
          className={styles.dangerButton}
          disabled={confirmation !== "停用账户"}
          onClick={onConfirm}
        >
          确认停用
        </button>
      </div>
    </DialogShell>
  );
}
