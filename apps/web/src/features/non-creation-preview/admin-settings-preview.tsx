"use client";

// 文件职责：渲染系统与定价设置高保真原型，包括分类保存、差异复核与版本冲突。
// 使用方：admin-tools-preview.tsx；所有配置均为虚构数据，不调用真实设置接口。

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import styles from "./admin-settings-preview.module.css";
import {
  type SettingCategory,
  type SettingEffect,
  type SettingField,
  type SettingSource,
  settingCategories,
} from "./admin-tools-mock-data";
import {
  readSettingCategoryId,
  writeSettingCategoryId,
} from "./admin-tools-url-state";

type SettingChange = {
  field: SettingField;
  before: string;
  after: string;
};

type SaveNotice = {
  tone: "success" | "warning" | "error";
  message: string;
  receipt?: {
    reason: string;
    auditId: string;
    idempotencyResult: string;
  };
} | null;

const sourceLabels: Readonly<Record<SettingSource, string>> = {
  database: "数据库",
  environment: "环境变量",
  default: "系统默认",
};

const effectLabels: Readonly<Record<SettingEffect, string>> = {
  immediate: "立即生效",
  restart: "需要重启",
  rebuild: "需要重构建",
};

/**
 * 创建所有设置字段的初始值快照，供本地草稿和已保存版本分别持有。
 *
 * @returns 以设置键为索引的字符串值，不包含任何真实环境配置。
 */
function createInitialSettingValues(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const category of settingCategories) {
    for (const field of category.fields) {
      values[field.key] = field.value;
    }
  }
  return values;
}

/**
 * 将原始设置值转换为差异面板中的安全可读文本。
 *
 * @param field 设置字段定义。
 * @param value 当前原始字符串值。
 * @returns 密钥已脱敏、枚举已翻译的展示文本。
 */
function formatSettingValue(field: SettingField, value: string): string {
  if (field.input === "secret") {
    return field.configured ? "已配置（值隐藏）" : "未配置";
  }
  if (field.input === "toggle") {
    return value === "true" ? "开启" : "关闭";
  }
  if (field.input === "select") {
    return (
      field.options?.find((option) => option.value === value)?.label ?? value
    );
  }
  return field.unit ? `${value} ${field.unit}` : value;
}

/**
 * 收集当前分类尚未保存的字段，并确保敏感值不会进入差异内容。
 *
 * @param category 当前设置分类。
 * @param draftValues 用户正在编辑的本地草稿。
 * @param savedValues 当前配置版本的本地快照。
 * @returns 当前分类的安全差异列表。
 */
function collectCategoryChanges(
  category: SettingCategory,
  draftValues: Readonly<Record<string, string>>,
  savedValues: Readonly<Record<string, string>>
): SettingChange[] {
  const changes: SettingChange[] = [];
  for (const field of category.fields) {
    const draftValue = draftValues[field.key] ?? field.value;
    const savedValue = savedValues[field.key] ?? field.value;
    if (field.input === "secret") {
      if (draftValue.length > 0) {
        changes.push({
          field,
          before: formatSettingValue(field, savedValue),
          after: "将替换（值隐藏）",
        });
      }
      continue;
    }
    if (draftValue !== savedValue) {
      changes.push({
        field,
        before: formatSettingValue(field, savedValue),
        after: formatSettingValue(field, draftValue),
      });
    }
  }
  return changes;
}

/**
 * 生成模拟服务器的新版本值，用于演示并发冲突后的重新比较流程。
 *
 * @param category 发生冲突的设置分类。
 * @param savedValues 冲突前的已保存快照。
 * @returns 带一个可见服务器变更的新快照。
 */
function createSimulatedServerValues(
  category: SettingCategory,
  savedValues: Readonly<Record<string, string>>
): Record<string, string> {
  const nextValues = { ...savedValues };
  const field = category.fields.find(
    (candidate) => !candidate.readOnly && candidate.input !== "secret"
  );
  if (!field) {
    return nextValues;
  }
  const currentValue = nextValues[field.key] ?? field.value;
  if (field.input === "number") {
    const parsedValue = Number(currentValue);
    nextValues[field.key] = Number.isFinite(parsedValue)
      ? String(parsedValue + 1)
      : currentValue;
  } else if (field.input === "toggle") {
    nextValues[field.key] = currentValue === "true" ? "false" : "true";
  } else if (field.input === "select") {
    nextValues[field.key] =
      field.options?.find((option) => option.value !== currentValue)?.value ??
      currentValue;
  } else {
    nextValues[field.key] = `${currentValue}（服务器版本）`;
  }
  return nextValues;
}

/**
 * 渲染带文字编码的后端健康状态，避免只依赖颜色传达结果。
 *
 * @param props.health 后端健康等级。
 * @param props.label 面向管理员的状态文本。
 * @returns 紧凑状态点与文字。
 */
function SettingControl({
  field,
  value,
  onChange,
}: {
  field: SettingField;
  value: string;
  onChange: (value: string) => void;
}) {
  let control: ReactNode;
  if (field.input === "toggle") {
    control = (
      <button
        type="button"
        role="switch"
        className={styles.switchControl}
        aria-label={field.label}
        aria-checked={value === "true"}
        disabled={field.readOnly}
        onClick={() => onChange(value === "true" ? "false" : "true")}
      >
        <span aria-hidden="true" />
        {value === "true" ? "已开启" : "已关闭"}
      </button>
    );
  } else if (field.input === "select") {
    control = (
      <select
        aria-label={field.label}
        value={value}
        disabled={field.readOnly}
        onChange={(event) => onChange(event.target.value)}
      >
        {field.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <div className={styles.inputWithUnit}>
        {field.input === "secret" && <KeyRound size={15} aria-hidden="true" />}
        <input
          aria-label={field.label}
          type={
            field.input === "secret"
              ? "password"
              : field.input === "number"
                ? "number"
                : "text"
          }
          value={value}
          disabled={field.readOnly}
          autoComplete={field.input === "secret" ? "new-password" : undefined}
          placeholder={
            field.input === "secret"
              ? field.configured
                ? "输入新密钥以替换现有值"
                : "输入新密钥"
              : undefined
          }
          onChange={(event) => onChange(event.target.value)}
        />
        {field.unit && <span>{field.unit}</span>}
      </div>
    );
  }

  return (
    <article className={styles.settingRow} data-readonly={field.readOnly}>
      <div className={styles.settingMeta}>
        <div className={styles.settingTitleLine}>
          <span>{field.label}</span>
          {field.configured && (
            <span className={styles.configuredStatus}>
              <ShieldCheck size={13} aria-hidden="true" />
              已配置
            </span>
          )}
        </div>
        <code>{field.key}</code>
        <p>{field.description}</p>
        <div className={styles.settingTags}>
          <span data-source={field.source}>
            {field.source === "environment" ? (
              <Cloud size={12} aria-hidden="true" />
            ) : (
              <Database size={12} aria-hidden="true" />
            )}
            {sourceLabels[field.source]}
          </span>
          <span data-effect={field.effect}>{effectLabels[field.effect]}</span>
          {field.readOnly && <span>只读覆盖</span>}
        </div>
      </div>
      <div className={styles.settingControl}>{control}</div>
    </article>
  );
}

/**
 * 渲染系统与定价设置原型，覆盖分类保存、差异复核和版本冲突演示。
 *
 * @returns 搜索目录、当前分类编辑器和固定变更栏。
 * @sideEffects 同步设置分类和 History API，不写入真实配置。
 */
export function SettingsPreview() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState(
    settingCategories[0]?.id ?? ""
  );
  const [savedValues, setSavedValues] = useState<Record<string, string>>(
    createInitialSettingValues
  );
  const [draftValues, setDraftValues] = useState<Record<string, string>>(
    createInitialSettingValues
  );
  const [reason, setReason] = useState("");
  const [sensitiveConfirmation, setSensitiveConfirmation] = useState("");
  const [simulateConflict, setSimulateConflict] = useState(false);
  const [conflictVisible, setConflictVisible] = useState(false);
  const [configVersion, setConfigVersion] = useState(42);
  const [notice, setNotice] = useState<SaveNotice>(null);

  useEffect(() => {
    const applyLocation = () => {
      setActiveCategoryId(readSettingCategoryId());
      setReason("");
      setSensitiveConfirmation("");
      setConflictVisible(false);
      setNotice(null);
    };
    const initialCategoryId = readSettingCategoryId();
    setActiveCategoryId(initialCategoryId);
    writeSettingCategoryId(initialCategoryId, "replace");
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, []);

  const currentCategory =
    settingCategories.find((category) => category.id === activeCategoryId) ??
    settingCategories[0];
  const filteredCategories = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      return settingCategories;
    }
    return settingCategories.filter((category) =>
      `${category.label} ${category.description} ${category.fields
        .map((field) => `${field.label} ${field.key}`)
        .join(" ")}`
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    );
  }, [searchQuery]);
  const currentChanges = useMemo(
    () =>
      currentCategory
        ? collectCategoryChanges(currentCategory, draftValues, savedValues)
        : [],
    [currentCategory, draftValues, savedValues]
  );
  const categoryChangeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const category of settingCategories) {
      counts[category.id] = collectCategoryChanges(
        category,
        draftValues,
        savedValues
      ).length;
    }
    return counts;
  }, [draftValues, savedValues]);
  const containsSensitiveChange = currentChanges.some(
    (change) => change.field.sensitive
  );

  /** 更新单个本地草稿字段，并清除上一轮保存结果。 */
  function handleFieldChange(key: string, value: string) {
    setDraftValues((current) => ({ ...current, [key]: value }));
    setNotice(null);
    setConflictVisible(false);
  }

  /** 切换设置分类，同时保留其他分类尚未保存的本地草稿。 */
  function handleSelectCategory(categoryId: string) {
    if (categoryId === activeCategoryId) {
      return;
    }
    setActiveCategoryId(categoryId);
    setReason("");
    setSensitiveConfirmation("");
    setNotice(null);
    setConflictVisible(false);
    writeSettingCategoryId(categoryId, "push");
  }

  /** 放弃当前分类的本地修改，不影响其他分类草稿。 */
  function handleResetCategory() {
    if (!currentCategory) {
      return;
    }
    setDraftValues((current) => {
      const nextValues = { ...current };
      for (const field of currentCategory.fields) {
        nextValues[field.key] = savedValues[field.key] ?? field.value;
      }
      return nextValues;
    });
    setReason("");
    setSensitiveConfirmation("");
    setConflictVisible(false);
    setNotice(null);
  }

  /**
   * 保存当前分类的本地模拟版本；缺少原因、密钥确认或版本一致性时拒绝提交。
   */
  function handleSaveCategory() {
    if (!currentCategory || currentChanges.length === 0) {
      return;
    }
    if (!reason.trim()) {
      setNotice({ tone: "error", message: "请填写变更原因后再保存。" });
      return;
    }
    if (containsSensitiveChange && sensitiveConfirmation.trim() !== "REPLACE") {
      setNotice({
        tone: "error",
        message: "密钥替换需要输入 REPLACE 确认，且密钥不会进入差异回执。",
      });
      return;
    }
    if (simulateConflict) {
      setConflictVisible(true);
      setNotice({
        tone: "warning",
        message: "保存已拒绝：服务器配置版本已变化，未覆盖任何字段。",
      });
      return;
    }

    const normalizedReason = reason.trim();
    const nextVersion = configVersion + 1;
    setSavedValues((current) => {
      const nextValues = { ...current };
      for (const change of currentChanges) {
        nextValues[change.field.key] =
          change.field.input === "secret"
            ? ""
            : (draftValues[change.field.key] ?? change.field.value);
      }
      return nextValues;
    });
    setDraftValues((current) => {
      const nextValues = { ...current };
      for (const change of currentChanges) {
        if (change.field.input === "secret") {
          nextValues[change.field.key] = "";
        }
      }
      return nextValues;
    });
    setConfigVersion((version) => version + 1);
    setReason("");
    setSensitiveConfirmation("");
    setNotice({
      tone: "success",
      message: `本地模拟已保存 ${currentChanges.length} 项，未调用真实设置接口。`,
      receipt: {
        reason: normalizedReason,
        auditId: `AUD-MOCK-20260712-${String(nextVersion).padStart(4, "0")}`,
        idempotencyResult: `idem_mock_settings_${currentCategory.id}_v${nextVersion} · 首次应用，未重复执行`,
      },
    });
  }

  /** 放弃本地草稿并载入模拟服务器的新版本。 */
  function handleLoadServerVersion() {
    if (!currentCategory) {
      return;
    }
    const serverValues = createSimulatedServerValues(
      currentCategory,
      savedValues
    );
    setSavedValues(serverValues);
    setDraftValues((current) => {
      const nextValues = { ...current };
      for (const field of currentCategory.fields) {
        nextValues[field.key] = serverValues[field.key] ?? field.value;
      }
      return nextValues;
    });
    setConfigVersion((version) => version + 1);
    setConflictVisible(false);
    setSimulateConflict(false);
    setReason("");
    setSensitiveConfirmation("");
    setNotice({
      tone: "warning",
      message: "已载入模拟服务器版本；本分类原草稿未被静默覆盖保存。",
    });
  }

  /** 保留本地草稿并更新服务器基线，供管理员重新检查差异后再次保存。 */
  function handleKeepLocalDraft() {
    if (!currentCategory) {
      return;
    }
    const serverValues = createSimulatedServerValues(
      currentCategory,
      savedValues
    );
    setSavedValues(serverValues);
    setConfigVersion((version) => version + 1);
    setConflictVisible(false);
    setSimulateConflict(false);
    setNotice({
      tone: "warning",
      message: "已保留本地草稿并刷新差异，请复核后再次保存。",
    });
  }

  if (!currentCategory) {
    return null;
  }

  return (
    <section className={styles.previewRoot} aria-label="系统设置工具">
      <div className={styles.settingsWorkspace}>
        <aside className={styles.settingsSidebar} aria-label="设置分类">
          <label className={styles.searchField}>
            <Search size={15} aria-hidden="true" />
            <span className={styles.srOnly}>搜索设置</span>
            <input
              type="search"
              value={searchQuery}
              placeholder="搜索分类或设置键"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          <nav>
            {filteredCategories.map((category) => (
              <button
                type="button"
                key={category.id}
                data-active={category.id === currentCategory.id}
                onClick={() => handleSelectCategory(category.id)}
              >
                <span>
                  <strong>{category.label}</strong>
                  <small>{category.description}</small>
                </span>
                {(categoryChangeCounts[category.id] ?? 0) > 0 && (
                  <span className={styles.changeCount}>
                    {categoryChangeCounts[category.id]}
                  </span>
                )}
              </button>
            ))}
            {filteredCategories.length === 0 && (
              <div className={styles.emptySearch}>
                <Search size={17} aria-hidden="true" />
                没有匹配的设置
              </div>
            )}
          </nav>
        </aside>

        <main className={styles.settingsEditor}>
          <header className={styles.settingsCategoryHeader}>
            <div>
              <span className={styles.overline}>分类独立保存</span>
              <h2>{currentCategory.label}</h2>
              <p>{currentCategory.description}</p>
            </div>
            <div className={styles.categoryHeaderMeta}>
              <span className={styles.versionBadge}>
                配置版本 v{configVersion}
              </span>
              <Settings2 size={19} aria-hidden="true" />
            </div>
          </header>

          {conflictVisible && (
            <section className={styles.conflictPanel} role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <strong>检测到配置版本冲突</strong>
                <p>
                  当前编辑基于 v{configVersion}，服务器已有更新。保存已拒绝，
                  没有静默覆盖其他管理员的修改。
                </p>
                <div className={styles.conflictActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={handleLoadServerVersion}
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    载入服务器版本
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={handleKeepLocalDraft}
                  >
                    保留草稿并重新比较
                  </button>
                </div>
              </div>
            </section>
          )}

          <div className={styles.settingsList}>
            {currentCategory.fields.map((field) => (
              <SettingControl
                key={field.key}
                field={field}
                value={draftValues[field.key] ?? field.value}
                onChange={(value) => handleFieldChange(field.key, value)}
              />
            ))}
          </div>

          <section className={styles.changeBar} aria-label="未保存变更">
            <div className={styles.changeBarHeader}>
              <div>
                <span className={styles.overline}>固定变更栏</span>
                <h3>
                  {currentChanges.length > 0
                    ? `${currentChanges.length} 项未保存修改`
                    : "当前分类没有未保存修改"}
                </h3>
              </div>
              {currentChanges.length > 0 && (
                <button
                  type="button"
                  className={styles.iconButton}
                  title="放弃当前分类修改"
                  aria-label="放弃当前分类修改"
                  onClick={handleResetCategory}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                </button>
              )}
            </div>

            {currentChanges.length > 0 && (
              <div className={styles.diffList}>
                {currentChanges.map((change) => (
                  <div key={change.field.key} className={styles.diffRow}>
                    <code>{change.field.key}</code>
                    <span className={styles.beforeValue}>{change.before}</span>
                    <span aria-hidden="true">→</span>
                    <span className={styles.afterValue}>{change.after}</span>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.saveControls}>
              <label>
                变更原因
                <input
                  type="text"
                  value={reason}
                  placeholder="必填，用于审计记录"
                  disabled={currentChanges.length === 0}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              {containsSensitiveChange && (
                <label>
                  密钥替换确认
                  <input
                    type="text"
                    value={sensitiveConfirmation}
                    placeholder="输入 REPLACE"
                    onChange={(event) =>
                      setSensitiveConfirmation(event.target.value)
                    }
                  />
                </label>
              )}
              <label className={styles.conflictToggle}>
                <input
                  type="checkbox"
                  checked={simulateConflict}
                  disabled={currentChanges.length === 0}
                  onChange={(event) =>
                    setSimulateConflict(event.target.checked)
                  }
                />
                下次保存模拟版本冲突
              </label>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={currentChanges.length === 0}
                onClick={handleSaveCategory}
              >
                <Save size={15} aria-hidden="true" />
                保存当前分类
              </button>
            </div>

            {containsSensitiveChange && (
              <p className={styles.sensitiveNotice}>
                <KeyRound size={14} aria-hidden="true" />
                密钥只支持替换；原值、新值和确认内容都不会进入差异或成功回执。
              </p>
            )}
            {notice && (
              <div className={styles.saveResult} role="status">
                <div className={styles.saveNotice} data-tone={notice.tone}>
                  {notice.tone === "success" && (
                    <CheckCircle2 size={15} aria-hidden="true" />
                  )}
                  {notice.tone === "warning" && (
                    <AlertCircle size={15} aria-hidden="true" />
                  )}
                  {notice.tone === "error" && (
                    <XCircle size={15} aria-hidden="true" />
                  )}
                  {notice.message}
                </div>
                {notice.receipt && (
                  <dl className={styles.saveReceipt}>
                    <div>
                      <dt>变更原因</dt>
                      <dd>{notice.receipt.reason}</dd>
                    </div>
                    <div>
                      <dt>审计号</dt>
                      <dd>{notice.receipt.auditId}</dd>
                    </div>
                    <div>
                      <dt>幂等结果</dt>
                      <dd>{notice.receipt.idempotencyResult}</dd>
                    </div>
                  </dl>
                )}
              </div>
            )}
          </section>
        </main>
      </div>
    </section>
  );
}
