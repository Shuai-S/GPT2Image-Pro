"use client";

// 文件职责：渲染生图后端池高保真原型，包括本地标签、紧凑列表、检查器与模拟测活。
// 使用方：admin-tools-preview.tsx；全部交互仅修改本地 state，不调用真实后端池服务。

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  CircleStop,
  Cloud,
  FolderTree,
  Loader2,
  PackageOpen,
  Play,
  RefreshCw,
  Server,
  SquareTerminal,
  UserRoundCog,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import styles from "./admin-backends-preview.module.css";
import {
  type ApiBackend,
  apiBackends,
  type BackendHealth,
  type BackendResource,
  type BackendView,
  backendResources,
  backendTabs,
} from "./admin-tools-mock-data";
import {
  type BackendTool,
  getDefaultBackendObjectId,
  readBackendUrlState,
  writeBackendUrlState,
} from "./admin-tools-url-state";

type HealthTestPhase = "idle" | "running" | "success" | "stopped";

type HealthTestState = {
  phase: HealthTestPhase;
  message: string;
};

type ApiSortKey =
  | "name"
  | "health"
  | "quota"
  | "concurrency"
  | "cooldown"
  | "error";

type SortDirection = "ascending" | "descending";

/**
 * 将后端字段转换为稳定排序值，未知额度和无冷却使用明确边界值。
 *
 * @param backend 待比较的 API 后端。
 * @param key 当前排序字段。
 * @returns 可比较的数字或文本值。
 */
function getApiSortValue(
  backend: ApiBackend,
  key: ApiSortKey
): number | string {
  if (key === "name") {
    return backend.name;
  }
  if (key === "health") {
    return { healthy: 0, warning: 1, offline: 2 }[backend.health];
  }
  if (key === "quota") {
    const quota = Number.parseInt(backend.quota, 10);
    return Number.isFinite(quota) ? quota : -1;
  }
  if (key === "concurrency") {
    const concurrency = Number.parseInt(backend.concurrency, 10);
    return Number.isFinite(concurrency) ? concurrency : -1;
  }
  if (key === "cooldown") {
    const [minutes = "0", seconds = "0"] = backend.cooldown.split(":");
    return backend.cooldown === "无"
      ? 0
      : Number.parseInt(minutes, 10) * 60 + Number.parseInt(seconds, 10);
  }
  return backend.lastError === "无" ? "" : backend.lastError;
}

/**
 * 渲染同时包含状态点和文字的后端健康状态。
 *
 * @param props.health 后端健康等级。
 * @param props.label 面向管理员的状态文本。
 * @returns 不只依赖颜色表达结果的紧凑状态。
 */
function HealthStatus({
  health,
  label,
}: {
  health: BackendHealth;
  label: string;
}) {
  return (
    <span className={styles.healthStatus} data-tone={health}>
      <span className={styles.healthDot} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * 渲染稳定列宽的排序按钮，并同时用图标和辅助文本表达方向。
 *
 * @param props.label 列标题。
 * @param props.sortKey 当前列对应的排序键。
 * @param props.activeKey 当前实际排序键。
 * @param props.direction 当前排序方向。
 * @param props.onSort 请求切换排序的回调。
 * @returns 可键盘操作的紧凑列头。
 */
function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: ApiSortKey;
  activeKey: ApiSortKey;
  direction: SortDirection;
  onSort: (key: ApiSortKey) => void;
}) {
  const active = sortKey === activeKey;
  const Icon = active
    ? direction === "ascending"
      ? ChevronUp
      : ChevronDown
    : ChevronsUpDown;
  return (
    <button
      type="button"
      data-active={active}
      aria-pressed={active}
      aria-label={`${label}，${
        active ? (direction === "ascending" ? "升序" : "降序") : "未排序"
      }`}
      onClick={() => onSort(sortKey)}
    >
      <span>{label}</span>
      <Icon size={11} aria-hidden="true" />
    </button>
  );
}

/**
 * 渲染 API 后端的右侧检查器及真实测活风险说明。
 *
 * @param props.backend 当前选中的虚构 API 后端。
 * @param props.testState 本地模拟测活状态。
 * @param props.onStartTest 启动本地模拟的回调。
 * @param props.onStopTest 停止本地模拟的回调。
 * @returns 固定宽度的后端详情与测活控制区。
 */
function ApiBackendInspector({
  backend,
  testState,
  onStartTest,
  onStopTest,
}: {
  backend: ApiBackend;
  testState: HealthTestState;
  onStartTest: () => void;
  onStopTest: () => void;
}) {
  return (
    <aside className={styles.inspector} aria-label={`${backend.name} 检查器`}>
      <div className={styles.inspectorHeader}>
        <div>
          <span className={styles.overline}>API 后端检查器</span>
          <h3>{backend.name}</h3>
        </div>
        <HealthStatus health={backend.health} label={backend.healthLabel} />
      </div>

      <dl className={styles.definitionList}>
        <div>
          <dt>协议</dt>
          <dd>{backend.protocol}</dd>
        </div>
        <div>
          <dt>端点</dt>
          <dd className={styles.monoValue}>{backend.endpoint}</dd>
        </div>
        <div>
          <dt>模型</dt>
          <dd>{backend.models}</dd>
        </div>
        <div>
          <dt>分组</dt>
          <dd>{backend.groups.join("、")}</dd>
        </div>
        <div>
          <dt>最近延迟</dt>
          <dd>{backend.latency}</dd>
        </div>
        <div>
          <dt>最近错误</dt>
          <dd>{backend.lastError}</dd>
        </div>
      </dl>

      <section className={styles.testSection} aria-labelledby="api-test-title">
        <div className={styles.sectionHeadingRow}>
          <div>
            <span className={styles.overline}>真实请求边界</span>
            <h4 id="api-test-title">生图测活</h4>
          </div>
          <Activity size={17} aria-hidden="true" />
        </div>
        <div className={styles.riskNotice}>
          <AlertTriangle size={16} aria-hidden="true" />
          <p>
            测活会提交 <code>n=1</code> 的真实上游生图任务，不扣站内用户积分。
            上游一旦受理，可能计入供应商图像额度或账单；鉴权或连通失败未必产生费用，
            但超时或手动停止也不能保证上游没有继续执行或计费。
          </p>
        </div>
        <p className={styles.prototypeBoundary}>
          当前为原型模拟，不会发出网络请求，也不会产生费用。
        </p>

        <div
          className={styles.testResult}
          data-phase={testState.phase}
          aria-live="polite"
        >
          <div className={styles.testResultIcon} aria-hidden="true">
            {testState.phase === "running" && (
              <Loader2 className={styles.spin} size={17} />
            )}
            {testState.phase === "success" && <CheckCircle2 size={17} />}
            {testState.phase === "stopped" && <CircleStop size={17} />}
            {testState.phase === "idle" && <Activity size={17} />}
          </div>
          <div>
            <strong>
              {testState.phase === "running" && "正在模拟上游生成"}
              {testState.phase === "success" && "模拟测活通过"}
              {testState.phase === "stopped" && "模拟已停止"}
              {testState.phase === "idle" && "尚未运行"}
            </strong>
            <span>{testState.message}</span>
          </div>
        </div>

        {testState.phase === "running" ? (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onStopTest}
          >
            <CircleStop size={15} aria-hidden="true" />
            停止模拟
          </button>
        ) : (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={onStartTest}
          >
            <Play size={15} aria-hidden="true" />
            直接模拟测活
          </button>
        )}
      </section>
    </aside>
  );
}

/**
 * 渲染 API 后端紧凑表格，并将选中项交给右侧检查器。
 *
 * @param props.selectedBackendId URL 驱动的当前 API 后端标识。
 * @param props.onSelectBackend 选择后端并写入 URL 的回调。
 * @returns 可排序状态列的静态高保真列表及本地测活流程。
 */
function ApiBackendsView({
  selectedBackendId,
  onSelectBackend,
}: {
  selectedBackendId: string;
  onSelectBackend: (backendId: string) => void;
}) {
  const [refreshLabel, setRefreshLabel] = useState("4 个已配置端点");
  const [sortKey, setSortKey] = useState<ApiSortKey>("health");
  const [sortDirection, setSortDirection] =
    useState<SortDirection>("ascending");
  const [testState, setTestState] = useState<HealthTestState>({
    phase: "idle",
    message: "选择后端后可直接开始；不会弹出二次确认。",
  });
  const selectedBackend =
    apiBackends.find((backend) => backend.id === selectedBackendId) ??
    apiBackends[0];
  const sortedBackends = useMemo(() => {
    const direction = sortDirection === "ascending" ? 1 : -1;
    return [...apiBackends].sort((left, right) => {
      const leftValue = getApiSortValue(left, sortKey);
      const rightValue = getApiSortValue(right, sortKey);
      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), "zh-CN");
      return comparison * direction;
    });
  }, [sortDirection, sortKey]);

  useEffect(() => {
    if (!selectedBackendId) {
      return;
    }
    setTestState({
      phase: "idle",
      message: "选择后端后可直接开始；不会弹出二次确认。",
    });
  }, [selectedBackendId]);

  useEffect(() => {
    if (testState.phase !== "running") {
      return;
    }
    const timer = window.setTimeout(() => {
      setTestState({
        phase: "success",
        message: "HTTP 200 · 2.8 秒 · 已返回 1 张模拟结果图。",
      });
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [testState.phase]);

  /** 切换当前检查对象，并重置仅属于上一对象的测活结果。 */
  function handleSelectBackend(backendId: string) {
    onSelectBackend(backendId);
  }

  /** 启动 1.6 秒的本地计时器来模拟一次 n=1 上游生图测活。 */
  function handleStartTest() {
    setTestState({
      phase: "running",
      message: "本地模拟正在运行；没有向所选端点发送请求。",
    });
  }

  /** 停止本地测活展示，并保留真实上游可能继续计费的边界提醒。 */
  function handleStopTest() {
    setTestState({
      phase: "stopped",
      message: "本地计时已停止；真实上游任务可能仍在执行或计费。",
    });
  }

  /** 刷新当前虚构列表的展示时间，不读取任何远端状态。 */
  function handleRefreshList() {
    setRefreshLabel("4 个已配置端点 · 刚刚刷新");
  }

  /** 对新列使用升序，再次点击当前列时反转排序方向。 */
  function handleSort(nextSortKey: ApiSortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((current) =>
        current === "ascending" ? "descending" : "ascending"
      );
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection("ascending");
  }

  if (!selectedBackend) {
    return null;
  }

  return (
    <div className={styles.splitWorkspace}>
      <section className={styles.listPane} aria-labelledby="api-list-title">
        <div className={styles.paneHeader}>
          <div>
            <span className={styles.overline}>{refreshLabel}</span>
            <h2 id="api-list-title">API 后端</h2>
            <p>比较健康、额度、并发、冷却与最近错误。</p>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            title="刷新本地模拟状态"
            aria-label="刷新本地模拟状态"
            onClick={handleRefreshList}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.tableScroll}>
          <div className={styles.apiTable}>
            <div className={styles.apiTableHeader}>
              <SortHeader
                label="后端"
                sortKey="name"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
              />
              <SortHeader
                label="健康"
                sortKey="health"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
              />
              <SortHeader
                label="额度"
                sortKey="quota"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
              />
              <SortHeader
                label="并发"
                sortKey="concurrency"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
              />
              <SortHeader
                label="冷却"
                sortKey="cooldown"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
              />
              <SortHeader
                label="最近错误"
                sortKey="error"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
              />
            </div>
            {sortedBackends.map((backend) => (
              <button
                type="button"
                className={styles.apiTableRow}
                data-selected={backend.id === selectedBackendId}
                key={backend.id}
                onClick={() => handleSelectBackend(backend.id)}
              >
                <span className={styles.backendNameCell}>
                  <Server size={15} aria-hidden="true" />
                  <span>
                    <strong>{backend.name}</strong>
                    <small>{backend.protocol}</small>
                  </span>
                </span>
                <span>
                  <HealthStatus
                    health={backend.health}
                    label={backend.healthLabel}
                  />
                </span>
                <span className={styles.numericCell}>{backend.quota}</span>
                <span className={styles.numericCell}>
                  {backend.concurrency}
                </span>
                <span className={styles.numericCell}>{backend.cooldown}</span>
                <span className={styles.errorCell}>{backend.lastError}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <ApiBackendInspector
        backend={selectedBackend}
        testState={testState}
        onStartTest={handleStartTest}
        onStopTest={handleStopTest}
      />
    </div>
  );
}

/**
 * 渲染分组、账号池或 Adobe 后端的紧凑资源列表与详情检查器。
 *
 * @param props.view 当前资源类型。
 * @param props.resources 对应的虚构资源集合。
 * @param props.selectedId URL 驱动的当前资源标识。
 * @param props.onSelectResource 选择资源并写入 URL 的回调。
 * @returns 无批量选择控件的主从列表。
 */
function ResourceListView({
  view,
  resources,
  selectedId,
  onSelectResource,
}: {
  view: Exclude<BackendView, "api" | "tools">;
  resources: readonly BackendResource[];
  selectedId: string;
  onSelectResource: (resourceId: string) => void;
}) {
  const selected =
    resources.find((resource) => resource.id === selectedId) ?? resources[0];
  const viewLabels: Readonly<
    Record<Exclude<BackendView, "api" | "tools">, string>
  > = {
    groups: "分组",
    accounts: "账号池",
    adobe: "Adobe 后端",
  };

  if (!selected) {
    return null;
  }

  return (
    <div className={styles.splitWorkspace}>
      <section className={styles.listPane}>
        <div className={styles.paneHeader}>
          <div>
            <span className={styles.overline}>
              {resources.length} 条模拟记录
            </span>
            <h2>{viewLabels[view]}</h2>
            <p>点击记录查看完整配置；首版仅支持逐项管理。</p>
          </div>
        </div>
        <div className={styles.resourceList}>
          <div className={styles.resourceListHeader} aria-hidden="true">
            <span>名称</span>
            <span>状态</span>
            <span>主要指标</span>
            <span>辅助指标</span>
          </div>
          {resources.map((resource) => (
            <button
              type="button"
              key={resource.id}
              className={styles.resourceRow}
              data-selected={resource.id === selectedId}
              onClick={() => onSelectResource(resource.id)}
            >
              <span className={styles.resourceName}>
                <strong>{resource.name}</strong>
                <small>{resource.detail}</small>
              </span>
              <HealthStatus
                health={resource.status}
                label={resource.statusLabel}
              />
              <span>
                <small>{resource.metricLabel}</small>
                <strong>{resource.metricValue}</strong>
              </span>
              <span>
                <small>{resource.secondaryLabel}</small>
                <strong>{resource.secondaryValue}</strong>
              </span>
            </button>
          ))}
        </div>
      </section>

      <aside
        className={styles.inspector}
        aria-label={`${selected.name} 检查器`}
      >
        <div className={styles.inspectorHeader}>
          <div>
            <span className={styles.overline}>{viewLabels[view]}检查器</span>
            <h3>{selected.name}</h3>
          </div>
          <HealthStatus health={selected.status} label={selected.statusLabel} />
        </div>
        <p className={styles.inspectorLead}>{selected.detail}</p>
        <dl className={styles.definitionList}>
          <div>
            <dt>{selected.metricLabel}</dt>
            <dd>{selected.metricValue}</dd>
          </div>
          <div>
            <dt>{selected.secondaryLabel}</dt>
            <dd>{selected.secondaryValue}</dd>
          </div>
          <div>
            <dt>最近更新</dt>
            <dd>今天 14:24</dd>
          </div>
          <div>
            <dt>管理方式</dt>
            <dd>逐项编辑，不提供批量操作</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}

/**
 * 渲染低频接入工具，并区分 Sub2API 同步与注册机两个独立任务。
 *
 * @param props.tool URL 驱动的当前接入工具标签。
 * @param props.onSelectTool 选择工具并写入 URL 的回调。
 * @returns 只产生本地结果消息的工具视图。
 */
function ConnectionToolsView({
  tool,
  onSelectTool,
}: {
  tool: BackendTool;
  onSelectTool: (tool: BackendTool) => void;
}) {
  const [result, setResult] = useState(
    "尚未运行；模拟操作不会读取远端账号或创建真实任务。"
  );

  /** 模拟当前接入任务，并明确结果只存在于浏览器状态。 */
  function handleRunTool() {
    setResult(
      tool === "sub2api"
        ? "模拟完成：发现 6 个新增账号、2 个待复核差异，未写入账号池。"
        : "模拟完成：已生成 5 条注册任务预览，未启动注册机。"
    );
  }

  return (
    <div className={styles.toolsWorkspace}>
      <header className={styles.paneHeader}>
        <div>
          <span className={styles.overline}>独立接入任务</span>
          <h2>接入工具</h2>
          <p>接入任务不属于表格批量编辑，执行结果仍需单独复核。</p>
        </div>
      </header>
      <div className={styles.toolTabs} role="tablist" aria-label="接入工具">
        <button
          type="button"
          role="tab"
          aria-selected={tool === "sub2api"}
          data-active={tool === "sub2api"}
          onClick={() => onSelectTool("sub2api")}
        >
          <Cloud size={15} aria-hidden="true" />
          同步 Sub2API
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tool === "register"}
          data-active={tool === "register"}
          onClick={() => onSelectTool("register")}
        >
          <SquareTerminal size={15} aria-hidden="true" />
          注册机
        </button>
      </div>

      <section className={styles.toolForm}>
        <div className={styles.toolIllustration} aria-hidden="true">
          {tool === "sub2api" ? (
            <Cloud size={24} />
          ) : (
            <SquareTerminal size={24} />
          )}
        </div>
        <div className={styles.toolCopy}>
          <h3>
            {tool === "sub2api" ? "读取远端账号差异" : "创建注册任务预览"}
          </h3>
          <p>
            {tool === "sub2api"
              ? "模拟比较远端清单与本地账号池，不自动启用新增账号。"
              : "模拟生成注册批次和资源需求，不启动浏览器或外部服务。"}
          </p>
        </div>
        <label className={styles.fieldLabel}>
          {tool === "sub2api" ? "服务地址" : "模拟任务数"}
          <input
            key={tool}
            type={tool === "sub2api" ? "url" : "number"}
            defaultValue={
              tool === "sub2api" ? "https://sub2api.example.test" : "5"
            }
          />
        </label>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={handleRunTool}
        >
          <Play size={15} aria-hidden="true" />
          运行本地模拟
        </button>
        <div className={styles.toolResult} aria-live="polite">
          <CheckCircle2 size={16} aria-hidden="true" />
          {result}
        </div>
      </section>
    </div>
  );
}

/**
 * 渲染生图后端池完整工具页，并默认进入 API 后端本地标签。
 *
 * @returns 五个本地视图及当前视图内容，不调用后端池服务。
 * @sideEffects 同步本地标签、检查对象和 History API。
 */
export function BackendPoolPreview() {
  const [activeView, setActiveView] = useState<BackendView>("api");
  const [selectedObjectId, setSelectedObjectId] = useState(
    getDefaultBackendObjectId("api")
  );
  const [activeTool, setActiveTool] = useState<BackendTool>("sub2api");

  useEffect(() => {
    const applyLocation = () => {
      const nextState = readBackendUrlState();
      setActiveView(nextState.view);
      setSelectedObjectId(nextState.objectId);
      setActiveTool(nextState.tool);
    };
    const initialState = readBackendUrlState();
    setActiveView(initialState.view);
    setSelectedObjectId(initialState.objectId);
    setActiveTool(initialState.tool);
    writeBackendUrlState(initialState, "replace");
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, []);

  /** 切换后端池标签，为目标视图选择首项并创建浏览器历史记录。 */
  function handleSelectView(nextView: BackendView) {
    if (nextView === activeView) {
      return;
    }
    const nextObjectId = getDefaultBackendObjectId(nextView);
    setActiveView(nextView);
    setSelectedObjectId(nextObjectId);
    writeBackendUrlState(
      { view: nextView, objectId: nextObjectId, tool: activeTool },
      "push"
    );
  }

  /** 选择当前标签中的检查对象并创建可返回、可分享的 URL 状态。 */
  function handleSelectObject(nextObjectId: string) {
    if (nextObjectId === selectedObjectId) {
      return;
    }
    setSelectedObjectId(nextObjectId);
    writeBackendUrlState(
      { view: activeView, objectId: nextObjectId, tool: activeTool },
      "push"
    );
  }

  /** 切换接入工具内部标签并创建浏览器历史记录。 */
  function handleSelectTool(nextTool: BackendTool) {
    if (nextTool === activeTool) {
      return;
    }
    setActiveTool(nextTool);
    writeBackendUrlState(
      { view: "tools", objectId: "", tool: nextTool },
      "push"
    );
  }

  return (
    <section className={styles.previewRoot} aria-label="生图后端池工具">
      <nav className={styles.backendTabs} aria-label="后端池视图">
        {backendTabs.map((tab) => {
          const Icon =
            tab.id === "groups"
              ? FolderTree
              : tab.id === "accounts"
                ? UserRoundCog
                : tab.id === "api"
                  ? Server
                  : tab.id === "adobe"
                    ? PackageOpen
                    : Wrench;
          return (
            <button
              type="button"
              key={tab.id}
              data-active={activeView === tab.id}
              aria-current={activeView === tab.id ? "page" : undefined}
              onClick={() => handleSelectView(tab.id)}
            >
              <Icon size={15} aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div className={styles.backendContent}>
        {activeView === "api" && (
          <ApiBackendsView
            selectedBackendId={selectedObjectId}
            onSelectBackend={handleSelectObject}
          />
        )}
        {activeView === "groups" && (
          <ResourceListView
            view="groups"
            resources={backendResources.groups}
            selectedId={selectedObjectId}
            onSelectResource={handleSelectObject}
          />
        )}
        {activeView === "accounts" && (
          <ResourceListView
            view="accounts"
            resources={backendResources.accounts}
            selectedId={selectedObjectId}
            onSelectResource={handleSelectObject}
          />
        )}
        {activeView === "adobe" && (
          <ResourceListView
            view="adobe"
            resources={backendResources.adobe}
            selectedId={selectedObjectId}
            onSelectResource={handleSelectObject}
          />
        )}
        {activeView === "tools" && (
          <ConnectionToolsView
            tool={activeTool}
            onSelectTool={handleSelectTool}
          />
        )}
      </div>
    </section>
  );
}
