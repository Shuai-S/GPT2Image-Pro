// 管理控制台原型的积分调整、密码重设和结构化操作结果层。

import {
  ArrowRight,
  BookOpenCheck,
  CircleUserRound,
  LockKeyhole,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AdminUser } from "./admin-mock-data";
import styles from "./admin-preview.module.css";
import { copy } from "./admin-preview-shared";

/** 高风险本地模拟操作的结构化结果。 */
export type OperationResult = {
  title: string;
  description: string;
  auditId: string;
  idempotencyId: string;
} | null;

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * 把键盘焦点约束在风险层内，支持 Escape，并在关闭后恢复触发控件。
 *
 * WHY：管理写操作不能让键盘用户误入后方表格。原型使用原生事件监听，确保 Tab
 * 循环、Shift+Tab、初始焦点和焦点恢复由同一处维护。
 *
 * @param dialogRef 当前模态面板引用。
 * @param onEscape Escape 关闭回调。
 * @sideEffects 注册键盘事件、移动焦点，并在卸载时恢复此前焦点。
 */
function useDialogFocus(
  dialogRef: RefObject<HTMLDivElement | null>,
  onEscape: () => void
) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusInitialControl = window.requestAnimationFrame(() => {
      const preferred = dialog.querySelector<HTMLElement>("[data-autofocus]");
      const fallback = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (preferred ?? fallback ?? dialog).focus();
    });

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusInitialControl);
      dialog.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [dialogRef, onEscape]);
}

/**
 * 渲染风险操作确认层并校验本地输入，不调用真实服务端能力。
 *
 * @param props 操作类型、目标用户、当前余额和确认回调。
 * @returns 带目标、影响、原因和输入校验的模态层。
 */
export function RiskOperationDialog({
  creditBalance,
  kind,
  locale,
  user,
  onCancel,
  onConfirmCredits,
  onConfirmPassword,
}: {
  creditBalance: number;
  kind: "credits" | "password";
  locale: string;
  user: AdminUser;
  onCancel: () => void;
  onConfirmCredits: (amount: number, reason: string, requestId: string) => void;
  onConfirmPassword: (reason: string, requestId: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [amount, setAmount] = useState("100");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestId] = useState(
    () => `admin-${kind}-${user.id}-${Date.now().toString(36)}`
  );
  useDialogFocus(dialogRef, onCancel);
  const parsedAmount = Number(amount);
  const nextBalance = Number.isFinite(parsedAmount)
    ? creditBalance + parsedAmount
    : creditBalance;

  /**
   * 校验风险操作表单并把已收窄的值交给本地模拟回调。
   *
   * @param event 表单提交事件。
   */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (reason.trim().length < 4) {
      setError(
        copy(
          locale,
          "Enter an operation reason of at least 4 characters.",
          "请填写至少 4 个字符的操作原因。"
        )
      );
      return;
    }
    if (kind === "credits") {
      if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
        setError(
          copy(
            locale,
            "Enter a non-zero credit change.",
            "请输入非零积分变更量。"
          )
        );
        return;
      }
      if (nextBalance < 0) {
        setError(
          copy(
            locale,
            "The resulting balance cannot be negative.",
            "变更后余额不能为负数。"
          )
        );
        return;
      }
      setSubmitting(true);
      onConfirmCredits(parsedAmount, reason.trim(), requestId);
      return;
    }
    if (password.length < 8) {
      setError(
        copy(
          locale,
          "The new password must be at least 8 characters.",
          "新密码至少需要 8 个字符。"
        )
      );
      return;
    }
    setSubmitting(true);
    onConfirmPassword(reason.trim(), requestId);
  };

  const isCreditOperation = kind === "credits";

  return (
    <div className={styles.dialogBackdrop} role="presentation">
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="risk-operation-title"
        aria-describedby="risk-operation-boundary"
        tabIndex={-1}
      >
        <div className={styles.dialogHeader}>
          <div>
            <span className={styles.eyebrow}>
              {copy(locale, "Controlled operation", "受控操作")}
            </span>
            <h2 id="risk-operation-title">
              {isCreditOperation
                ? copy(locale, "Adjust user credits", "调整用户积分")
                : copy(locale, "Set a new password", "设置用户新密码")}
            </h2>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={copy(locale, "Cancel", "取消")}
            title={copy(locale, "Cancel", "取消")}
            onClick={onCancel}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.operationTarget}>
            <CircleUserRound size={17} aria-hidden="true" />
            <div>
              <span>{copy(locale, "Target user", "目标用户")}</span>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </div>
          </div>

          {isCreditOperation ? (
            <>
              <div className={styles.changePreview}>
                <div>
                  <span>{copy(locale, "Current", "变更前")}</span>
                  <strong>{creditBalance.toLocaleString(locale)}</strong>
                </div>
                <ArrowRight size={17} aria-hidden="true" />
                <div>
                  <span>{copy(locale, "After", "变更后")}</span>
                  <strong>{nextBalance.toLocaleString(locale)}</strong>
                </div>
              </div>
              <label className={styles.formField}>
                <span>{copy(locale, "Credit change", "积分变更量")}</span>
                <input
                  data-autofocus
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setError(null);
                  }}
                />
                <small>
                  {copy(
                    locale,
                    "Use a negative number to deduct credits.",
                    "输入负数表示扣减；真实接入必须写入双重记账。"
                  )}
                </small>
              </label>
            </>
          ) : (
            <>
              <div className={styles.impactNotice}>
                <LockKeyhole size={16} aria-hidden="true" />
                <p>
                  <strong>
                    {copy(locale, "Authentication impact", "认证影响")}
                  </strong>
                  <span>
                    {copy(
                      locale,
                      `This sets a formal password and revokes ${user.currentSessions} active sessions. The user is not forced to change it after login.`,
                      `这将设置正式密码，并撤销 ${user.currentSessions} 个现有会话；用户登录后不强制修改。`
                    )}
                  </span>
                </p>
              </div>
              <label className={styles.formField}>
                <span>{copy(locale, "New password", "新密码")}</span>
                <input
                  data-autofocus
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError(null);
                  }}
                />
                <small>
                  {copy(
                    locale,
                    "The password is never written to audit logs or receipts.",
                    "密码不会写入审计日志、回执或其他模拟状态。"
                  )}
                </small>
              </label>
            </>
          )}

          <label className={styles.formField}>
            <span>{copy(locale, "Operation reason", "操作原因")}</span>
            <textarea
              rows={3}
              value={reason}
              placeholder={copy(
                locale,
                "Required for the resource audit record",
                "必填，将写入资源审计记录"
              )}
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
            />
          </label>

          {error && <p className={styles.formError}>{error}</p>}

          <div className={styles.dialogFooter}>
            <span id="risk-operation-boundary">
              {copy(
                locale,
                "Prototype only. No real action will run.",
                "仅本地模拟，不会执行真实操作。"
              )}
            </span>
            <button type="button" onClick={onCancel}>
              {copy(locale, "Cancel", "取消")}
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={submitting}
            >
              {copy(locale, "Confirm operation", "确认操作")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * 展示风险操作的审计编号和幂等结果，避免只用短暂提示收尾。
 *
 * @param props.result 本地模拟操作结果。
 * @param props.locale 当前语言。
 * @param props.onClose 关闭结果层。
 * @returns 可核对的操作结果面板。
 */
export function OperationResultDialog({
  locale,
  result,
  onClose,
}: {
  locale: string;
  result: Exclude<OperationResult, null>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);

  return (
    <div className={styles.dialogBackdrop} role="presentation">
      <div
        ref={dialogRef}
        className={styles.resultDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="operation-result-title"
        aria-describedby="operation-result-description"
        tabIndex={-1}
      >
        <div className={styles.resultMark}>
          <BookOpenCheck size={19} aria-hidden="true" />
        </div>
        <span className={styles.eyebrow}>
          {copy(locale, "Mock result", "模拟结果")}
        </span>
        <h2 id="operation-result-title">{result.title}</h2>
        <p id="operation-result-description">{result.description}</p>
        <dl className={styles.resultDetails}>
          <div>
            <dt>{copy(locale, "Audit ID", "审计编号")}</dt>
            <dd>{result.auditId}</dd>
          </div>
          <div>
            <dt>{copy(locale, "Idempotency result", "幂等结果")}</dt>
            <dd>{result.idempotencyId}</dd>
          </div>
        </dl>
        <button
          type="button"
          className={styles.primaryButton}
          data-autofocus
          onClick={onClose}
        >
          {copy(locale, "Done", "完成")}
        </button>
      </div>
    </div>
  );
}
