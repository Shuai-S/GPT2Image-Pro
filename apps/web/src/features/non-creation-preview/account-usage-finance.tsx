"use client";

// 账户中心订单与用量中的财务只读视图。分别展示积分流水和法币支付订单。

import { creditLedger, paymentOrders } from "./account-mock-data";
import sharedStyles from "./account-preview.module.css";
import {
  DataRegion,
  formatCredits,
  StatusText,
} from "./account-preview-shared";

/**
 * 渲染积分流水的桌面表格与手机记录列表。
 *
 * @returns 正负方向和余额保持一致的只读积分流水。
 * @sideEffects 无；不读取或修改真实积分账本。
 */
export function CreditLedgerTable() {
  return (
    <DataRegion title="积分流水" description="余额变更以积分交易账本为准">
      <div className={sharedStyles.desktopTable}>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>参考</th>
              <th className={sharedStyles.numericCell}>变动</th>
              <th className={sharedStyles.numericCell}>余额</th>
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
                <td className={sharedStyles.numericCell} data-tone={row.tone}>
                  {row.amount > 0 ? "+" : ""}
                  {formatCredits(row.amount)}
                </td>
                <td className={sharedStyles.numericCell}>
                  {formatCredits(row.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={sharedStyles.recordList}>
        {creditLedger.map((row) => (
          <article className={sharedStyles.recordItem} key={row.id}>
            <div className={sharedStyles.recordItemHeader}>
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
 * 渲染支付订单的桌面表格与手机记录列表。
 *
 * @returns 分离支付状态与履约状态的法币订单只读视图。
 * @sideEffects 无；不调用支付渠道或修改财务事实。
 */
export function PaymentOrdersTable() {
  return (
    <DataRegion title="支付订单" description="订单状态来自支付渠道与履约记录">
      <div className={sharedStyles.desktopTable}>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>订单</th>
              <th>购买内容</th>
              <th>支付状态</th>
              <th>履约状态</th>
              <th className={sharedStyles.numericCell}>金额</th>
            </tr>
          </thead>
          <tbody>
            {paymentOrders.map((row) => (
              <tr key={row.id}>
                <td>{row.occurredAt}</td>
                <td className={sharedStyles.monoText}>{row.id}</td>
                <td>{row.item}</td>
                <td>
                  <StatusText status={row.paymentStatus} />
                </td>
                <td>
                  <StatusText status={row.fulfillmentStatus} />
                </td>
                <td className={sharedStyles.numericCell}>{row.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={sharedStyles.recordList}>
        {paymentOrders.map((row) => (
          <article className={sharedStyles.recordItem} key={row.id}>
            <div className={sharedStyles.recordItemHeader}>
              <strong>{row.item}</strong>
              <span>{row.amount}</span>
            </div>
            <p className={sharedStyles.monoText}>{row.id}</p>
            <div className={sharedStyles.mobileStatusRow}>
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
