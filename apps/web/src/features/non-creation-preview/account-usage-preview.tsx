"use client";

// 账户中心订单与用量原型。分别展示积分、法币订单和生成请求的账务上下文。

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  creditLedger,
  generationUsage,
  paymentOrders,
} from "./account-mock-data";
import styles from "./account-preview.module.css";
import {
  DataRegion,
  formatCredits,
  PageHeading,
  SegmentedTabs,
  StatusText,
} from "./account-preview-shared";

type UsageTab = "credits" | "payments" | "generations";

/**
 * 渲染订单与用量的三个一级账务标签。
 *
 * @returns 积分流水、支付订单和生成用量的桌面表格与手机记录列表。
 * @sideEffects 仅切换本地标签，不读取或修改真实账务数据。
 */
export function UsagePage() {
  const [tab, setTab] = useState<UsageTab>("credits");

  return (
    <section>
      <PageHeading
        eyebrow="资金与权益"
        title="订单与用量"
        description="分别核对积分余额变化、法币支付和每次生成请求。"
      />
      <SegmentedTabs
        value={tab}
        items={[
          { id: "credits", label: "积分流水" },
          { id: "payments", label: "支付订单" },
          { id: "generations", label: "生成用量" },
        ]}
        onChange={setTab}
      />

      {tab === "credits" && <CreditLedgerTable />}
      {tab === "payments" && <PaymentOrdersTable />}
      {tab === "generations" && <GenerationUsageTable />}
    </section>
  );
}

/**
 * 渲染积分流水的双端布局。
 *
 * @returns 桌面紧凑表格及手机分组记录，正负方向保持一致。
 * @sideEffects 无。
 */
function CreditLedgerTable() {
  return (
    <DataRegion title="积分流水" description="余额变更以积分交易账本为准">
      <div className={styles.desktopTable}>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>参考</th>
              <th className={styles.numericCell}>变动</th>
              <th className={styles.numericCell}>余额</th>
            </tr>
          </thead>
          <tbody>
            {creditLedger.map((row) => (
              <tr key={row.id}>
                <td>{row.occurredAt}</td>
                <td>
                  <strong>{row.title}</strong>
                  <small>{row.id}</small>
                </td>
                <td>{row.reference}</td>
                <td className={styles.numericCell} data-tone={row.tone}>
                  {row.amount > 0 ? "+" : ""}
                  {formatCredits(row.amount)}
                </td>
                <td className={styles.numericCell}>
                  {formatCredits(row.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.recordList}>
        {creditLedger.map((row) => (
          <article className={styles.recordItem} key={row.id}>
            <div className={styles.recordItemHeader}>
              <strong>{row.title}</strong>
              <span data-tone={row.tone}>
                {row.amount > 0 ? "+" : ""}
                {formatCredits(row.amount)}
              </span>
            </div>
            <p>{row.reference}</p>
            <dl>
              <div>
                <dt>时间</dt>
                <dd>{row.occurredAt}</dd>
              </div>
              <div>
                <dt>余额</dt>
                <dd>{formatCredits(row.balance)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </DataRegion>
  );
}

/**
 * 渲染法币支付订单的双端布局。
 *
 * @returns 分离支付状态和积分履约状态的只读订单记录。
 * @sideEffects 无。
 */
function PaymentOrdersTable() {
  return (
    <DataRegion title="支付订单" description="订单状态来自支付渠道与履约记录">
      <div className={styles.desktopTable}>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>订单</th>
              <th>购买内容</th>
              <th>支付状态</th>
              <th>履约状态</th>
              <th className={styles.numericCell}>金额</th>
            </tr>
          </thead>
          <tbody>
            {paymentOrders.map((row) => (
              <tr key={row.id}>
                <td>{row.occurredAt}</td>
                <td className={styles.monoText}>{row.id}</td>
                <td>{row.item}</td>
                <td>
                  <StatusText status={row.paymentStatus} />
                </td>
                <td>
                  <StatusText status={row.fulfillmentStatus} />
                </td>
                <td className={styles.numericCell}>{row.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.recordList}>
        {paymentOrders.map((row) => (
          <article className={styles.recordItem} key={row.id}>
            <div className={styles.recordItemHeader}>
              <strong>{row.item}</strong>
              <span>{row.amount}</span>
            </div>
            <p className={styles.monoText}>{row.id}</p>
            <div className={styles.mobileStatusRow}>
              <StatusText status={row.paymentStatus} />
              <StatusText status={row.fulfillmentStatus} />
            </div>
            <time>{row.occurredAt}</time>
          </article>
        ))}
      </div>
    </DataRegion>
  );
}

/**
 * 渲染生成请求用量的双端布局。
 *
 * @returns 模型、来源、图数、状态与实际积分消耗记录。
 * @sideEffects 无；图库跳转仅作为原型命令展示。
 */
function GenerationUsageTable() {
  return (
    <DataRegion title="生成用量" description="生成上下文不替代积分交易账本">
      <div className={styles.desktopTable}>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>请求</th>
              <th>模型</th>
              <th>来源</th>
              <th>张数</th>
              <th>状态</th>
              <th className={styles.numericCell}>实际积分</th>
            </tr>
          </thead>
          <tbody>
            {generationUsage.map((row) => (
              <tr key={row.id}>
                <td>{row.occurredAt}</td>
                <td>
                  <button type="button" className={styles.textButton}>
                    {row.id}
                    <ChevronRight size={13} aria-hidden="true" />
                  </button>
                </td>
                <td>{row.model}</td>
                <td>{row.source}</td>
                <td>{row.images}</td>
                <td>
                  <StatusText status={row.status} />
                </td>
                <td className={styles.numericCell}>
                  {formatCredits(row.credits)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.recordList}>
        {generationUsage.map((row) => (
          <article className={styles.recordItem} key={row.id}>
            <div className={styles.recordItemHeader}>
              <strong>{row.model}</strong>
              <StatusText status={row.status} />
            </div>
            <p>
              {row.source} · {row.images} 张 · {formatCredits(row.credits)} 积分
            </p>
            <dl>
              <div>
                <dt>请求</dt>
                <dd className={styles.monoText}>{row.id}</dd>
              </div>
              <div>
                <dt>时间</dt>
                <dd>{row.occurredAt}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </DataRegion>
  );
}
