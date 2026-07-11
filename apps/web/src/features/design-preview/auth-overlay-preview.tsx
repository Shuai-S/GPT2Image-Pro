"use client";

// 统一认证覆盖层原型。供公开页与创作页复用登录、注册、找回和重置密码状态。

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  Mail,
  UserPlus,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import styles from "./design-preview.module.css";

export type AuthPreviewMode =
  | "sign-in"
  | "sign-up"
  | "forgot-password"
  | "reset-password";

export type AuthRequestContext = {
  prompt: string;
  modelName: string;
  cost: number;
};

const authPreviewModes = new Set<AuthPreviewMode>([
  "sign-in",
  "sign-up",
  "forgot-password",
  "reset-password",
]);

/**
 * 校验 URL 中的认证状态。
 *
 * @param value 未信任的查询参数。
 * @returns 参数属于支持的认证覆盖层状态时返回 true。
 * @sideEffects 无。
 */
export function isAuthPreviewMode(
  value: string | null
): value is AuthPreviewMode {
  return value !== null && authPreviewModes.has(value as AuthPreviewMode);
}

/**
 * 渲染统一认证覆盖层并模拟四种认证流程。
 *
 * @param props.mode 当前认证步骤。
 * @param props.initialInviteCode 注册链接预填的邀请码。
 * @param props.requestContext 受保护动作被拦截时保留的创作摘要。
 * @param props.onModeChange 切换认证步骤并同步 URL。
 * @param props.onClose 关闭覆盖层并恢复原页面。
 * @param props.onAuthenticated 完成本地认证模拟。
 * @returns 可键盘关闭、约束焦点且不调用真实认证接口的覆盖层。
 * @sideEffects 仅管理本地表单状态和焦点。
 */
export function AuthOverlayPreview({
  mode,
  initialInviteCode,
  requestContext,
  onModeChange,
  onClose,
  onAuthenticated,
}: {
  mode: AuthPreviewMode;
  initialInviteCode: string;
  requestContext: AuthRequestContext | null;
  onModeChange: (mode: AuthPreviewMode) => void;
  onClose: () => void;
  onAuthenticated: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [email, setEmail] = useState("zs@example.test");
  const [password, setPassword] = useState("preview-password");
  const [confirmedPassword, setConfirmedPassword] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [accountScenario, setAccountScenario] = useState<"active" | "disabled">(
    "active"
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const firstField =
      dialogRef.current?.querySelector<HTMLElement>("input:not([disabled])") ??
      dialogRef.current?.querySelector<HTMLElement>("button:not([disabled])");
    firstField?.focus();

    return () => previousFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    setInviteCode(initialInviteCode);
  }, [initialInviteCode]);

  /**
   * 切换认证步骤并清理上一步的局部反馈。
   *
   * @param nextMode 目标认证步骤。
   * @sideEffects 清除错误和结果后通知父组件同步 URL。
   */
  const changeMode = (nextMode: AuthPreviewMode) => {
    setError(null);
    setResult(null);
    onModeChange(nextMode);
  };

  /**
   * 将 Tab 焦点约束在当前对话框内，并允许 Escape 关闭。
   *
   * @param event 对话框键盘事件。
   * @sideEffects 必要时移动焦点或关闭覆盖层。
   */
  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), a[href]"
      ) ?? []
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  /**
   * 提交当前认证步骤的本地模拟。
   *
   * @param event 表单提交事件。
   * @sideEffects 更新错误或结果；成功登录与注册时通知父组件继续受保护动作。
   */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (mode === "sign-in") {
      if (accountScenario === "disabled") {
        setError("此账户已停用，无法登录。如需恢复，请联系支持。");
        return;
      }
      onAuthenticated();
      return;
    }

    if (mode === "sign-up") {
      const normalizedInviteCode = inviteCode.trim().toUpperCase();
      if (
        normalizedInviteCode.length > 0 &&
        !/^[A-Z0-9]{6}$/.test(normalizedInviteCode)
      ) {
        setError("邀请码无效或当前不可用，请修改或清空后继续。");
        return;
      }
      onAuthenticated();
      return;
    }

    if (mode === "forgot-password") {
      setResult("账户身份已验证，可以继续设置新密码。");
      return;
    }

    if (password.length < 10) {
      setError("密码至少需要 10 个字符。");
      return;
    }
    if (password !== confirmedPassword) {
      setError("两次输入的密码不一致。");
      return;
    }
    setResult("密码已更新，请使用新密码登录。");
  };

  const content = getAuthContent(mode);

  return (
    <div className={styles.authOverlay}>
      <button
        type="button"
        className={styles.authBackdrop}
        aria-label="关闭认证层"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className={styles.authDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleDialogKeyDown}
      >
        <header className={styles.authHeader}>
          <div>
            <span className={styles.authBrand}>GPT2IMAGE</span>
            <span className={styles.authModeLabel}>{content.eyebrow}</span>
          </div>
          <button
            type="button"
            className={styles.authCloseButton}
            aria-label="关闭认证层"
            title="关闭"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.authIntroduction}>
          <span className={styles.authIcon}>
            <content.icon size={17} aria-hidden="true" />
          </span>
          <div>
            <h2 id={titleId}>{content.title}</h2>
            <p id={descriptionId}>{content.description}</p>
          </div>
        </div>

        {requestContext && mode === "sign-in" && (
          <div className={styles.authContext}>
            <span>待继续创作</span>
            <strong>{summarizePrompt(requestContext.prompt)}</strong>
            <span>{requestContext.modelName}</span>
            <span>{requestContext.cost} 积分</span>
          </div>
        )}

        <form className={styles.authForm} onSubmit={handleSubmit}>
          {mode === "sign-in" && (
            <fieldset className={styles.authScenario}>
              <legend>账户状态</legend>
              <button
                type="button"
                data-active={accountScenario === "active"}
                onClick={() => setAccountScenario("active")}
              >
                正常
              </button>
              <button
                type="button"
                data-active={accountScenario === "disabled"}
                onClick={() => setAccountScenario("disabled")}
              >
                已停用
              </button>
            </fieldset>
          )}

          {mode !== "reset-password" && (
            <label className={styles.authField}>
              <span>邮箱</span>
              <span className={styles.authInputFrame}>
                <Mail size={14} aria-hidden="true" />
                <input
                  type="email"
                  value={email}
                  autoComplete="email"
                  required
                  onChange={(event) => setEmail(event.target.value)}
                />
              </span>
            </label>
          )}

          {(mode === "sign-in" || mode === "sign-up") && (
            <label className={styles.authField}>
              <span>密码</span>
              <span className={styles.authInputFrame}>
                <LockKeyhole size={14} aria-hidden="true" />
                <input
                  type="password"
                  value={password}
                  autoComplete={
                    mode === "sign-up" ? "new-password" : "current-password"
                  }
                  required
                  minLength={10}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </span>
            </label>
          )}

          {mode === "sign-up" && (
            <label className={styles.authField}>
              <span>
                邀请码 <small>选填</small>
              </span>
              <span className={styles.authInputFrame}>
                <UserPlus size={14} aria-hidden="true" />
                <input
                  type="text"
                  value={inviteCode}
                  autoComplete="off"
                  maxLength={24}
                  onChange={(event) => setInviteCode(event.target.value)}
                />
                {inviteCode && (
                  <button
                    type="button"
                    aria-label="清空邀请码"
                    title="清空"
                    onClick={() => setInviteCode("")}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                )}
              </span>
            </label>
          )}

          {mode === "reset-password" && (
            <>
              <label className={styles.authField}>
                <span>新密码</span>
                <span className={styles.authInputFrame}>
                  <KeyRound size={14} aria-hidden="true" />
                  <input
                    type="password"
                    value={password}
                    autoComplete="new-password"
                    required
                    minLength={10}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </span>
              </label>
              <label className={styles.authField}>
                <span>确认新密码</span>
                <span className={styles.authInputFrame}>
                  <LockKeyhole size={14} aria-hidden="true" />
                  <input
                    type="password"
                    value={confirmedPassword}
                    autoComplete="new-password"
                    required
                    minLength={10}
                    onChange={(event) =>
                      setConfirmedPassword(event.target.value)
                    }
                  />
                </span>
              </label>
            </>
          )}

          {error && (
            <div
              className={styles.authFeedback}
              data-tone="danger"
              role="alert"
            >
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          {result && (
            <div
              className={styles.authFeedback}
              data-tone="success"
              role="status"
            >
              <CheckCircle2 size={14} aria-hidden="true" />
              <span>{result}</span>
            </div>
          )}

          <div className={styles.authActions}>
            {mode === "sign-in" && (
              <button
                type="button"
                className={styles.authTextButton}
                onClick={() => changeMode("forgot-password")}
              >
                忘记密码
              </button>
            )}
            {mode === "forgot-password" && result ? (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => changeMode("reset-password")}
              >
                设置新密码
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            ) : mode === "reset-password" && result ? (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => changeMode("sign-in")}
              >
                返回登录
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            ) : (
              <button type="submit" className={styles.primaryButton}>
                {content.submitLabel}
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </form>

        <footer className={styles.authFooter}>
          {mode === "sign-in" ? (
            <>
              <span>还没有账户？</span>
              <button type="button" onClick={() => changeMode("sign-up")}>
                注册
              </button>
            </>
          ) : (
            <>
              <span>已有账户？</span>
              <button type="button" onClick={() => changeMode("sign-in")}>
                登录
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

/**
 * 返回当前认证步骤的固定展示文本和图标。
 *
 * @param mode 当前认证步骤。
 * @returns 标题、说明、提交命令与图标。
 * @sideEffects 无。
 */
function getAuthContent(mode: AuthPreviewMode) {
  if (mode === "sign-up") {
    return {
      eyebrow: "创建账户",
      title: "注册 GPT2IMAGE",
      description: "创建新账户，开始保存作品与使用固定期限权益。",
      submitLabel: "创建账户",
      icon: UserPlus,
    };
  }
  if (mode === "forgot-password") {
    return {
      eyebrow: "账户恢复",
      title: "找回密码",
      description: "验证账户邮箱后继续设置新密码。",
      submitLabel: "继续验证",
      icon: Mail,
    };
  }
  if (mode === "reset-password") {
    return {
      eyebrow: "账户恢复",
      title: "设置新密码",
      description: "新密码生效后，使用它重新登录账户。",
      submitLabel: "更新密码",
      icon: KeyRound,
    };
  }
  return {
    eyebrow: "欢迎回来",
    title: "登录 GPT2IMAGE",
    description: "登录后继续当前页面，并恢复未完成的操作。",
    submitLabel: "登录并继续",
    icon: LockKeyhole,
  };
}

/**
 * 截断认证层中的提示词摘要，避免长文本撑开对话框。
 *
 * @param prompt 原始提示词。
 * @returns 最长 48 个字符的单行摘要。
 * @sideEffects 无。
 */
function summarizePrompt(prompt: string) {
  const normalized = prompt.trim() || "未命名创作";
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}
