# 邀请返佣转积分闭环

## 背景

本系统参考 `Wei-Shaw/sub2api` 的 affiliate 机制，但不引入现金余额或提现。
返佣先进入独立权益账本，用户确认后再转换为站内积分，积分发放继续以
`credits_batch` 与 `credits_transaction` 为财务真相。

## 范围

- 一级邀请，不做多级分销。
- 只对真实支付履约订单返佣，不对注册奖励、管理员赠送、退款或失败订单返佣。
- 返佣奖励模式固定为 `credits`，后续可扩展现金提现但不在 MVP 内。
- 用户可在 Dashboard 查看邀请码、邀请链接、返佣汇总与被邀请用户，并手动转积分。

## 数据模型

- `referral_profile`：用户邀请码、是否自定义、专属返佣比例、累计邀请数。
- `referral_binding`：邀请人与被邀请人的一次性绑定关系。
- `referral_commission_ledger`：每笔支付订单产生的返佣权益账本。
- `referral_transfer`：用户把可用返佣转换为积分的转出记录。

## 核心流程

1. 用户访问 `/{locale}/invite/{code}`，服务端归一化邀请码，写入短期 Cookie，
   并跳转到 `/{locale}/sign-up?ref={code}`。
2. 注册成功后，Better Auth user create hook 通过 UOL
   `referral.bindInviterByCode` 绑定邀请关系。绑定只允许一次，禁止自邀。
3. Creem / Epay / Alipay 支付履约发放原有积分后，再通过 UOL
   `referral.accrueCommissionForOrder` 生成返佣账本。
4. 返佣按实付金额、比例快照、有效期、单 invitee 上限计算，并用
   `(provider, orderId, inviterUserId)` 唯一约束防 webhook 重放双发。
5. 返佣根据冻结期进入 `frozen` 或 `available`；内部定时任务与用户读取时都会解冻
   已到期返佣。
6. 用户点击转积分时，通过 UOL `referral.convertAvailableCommissionToCredits`
   将所有 `available` 返佣原子 claim 为 `converting`，调用 `grantCredits`
   发放 `sourceType=referral`、`transactionType=referral_bonus` 的积分批次，
   再把账本置为 `converted`。
7. 退款、拒付或管理员取消订单后，通过 UOL `referral.cancelCommissionForOrder`
   或 `admin.referral.cancelCommissionForOrder` 取消仍处于 `frozen` /
   `available` / `converting` 的返佣；已 `converted` 的返佣使用
   `consumeCredits` 以 `sourceRef=referral_reversal:{commissionId}:{reason}`
   幂等扣回对应积分，再把账本置为 `canceled`。
   `converting` 账本若已有 pending 转积分记录，会先按同一 `sourceRef`
   幂等完成转积分收尾，再进入已转积分冲正路径，避免退款与转积分并发时出现
   已发积分但返佣账本被直接取消的状态。

## 幂等与并发

- 支付返佣：`referral_commission_order_inviter_unique` 防重复入账。
- 单 invitee 返佣上限：支付入账在事务内按 `inviterUserId + inviteeUserId`
  获取 `pg_advisory_xact_lock` 后重新读取累计返佣，避免多个 webhook 并发同时
  读到旧累计值而突破 `REFERRAL_PER_INVITEE_CAP_CENTS`。
- 转积分：`referral_transfer.source_ref` 与 `credits_batch(source_type, source_ref)`
  共同防重复发放。
- 转积分金额以 claim 后返回的账本行为准，避免并发窗口中按过期 select 结果算错金额。
- 同一用户转积分请求在 claim 前获取用户维度事务级 advisory lock，确保相同
  `requestId` 并发调用能先看到已存在的 `referral_transfer.source_ref`，不同
  `requestId` 并发调用也只会有一个请求 claim 到当前 available 账本。
- `grantCredits` 交易记录写入 `sourceRef`，使双重记账与批次幂等键可互相追溯。
- 退款冲正：每条返佣账本用独立 `referral_reversal:{commissionId}:{reason}` 作为
  `credits_transaction(user_id,type,source_ref)` 幂等键，防重复扣回。
- 退款与转积分竞态：冲正 `converting` 账本前按 `commissionIds @>`
  找到 pending `referral_transfer` 并调用同一收尾逻辑，利用
  `credits_batch(source_type, source_ref)` 防止重复发放，再扣回已转积分。

## 运行时配置

- `REFERRAL_ENABLED`：总开关，默认关闭。
- `REFERRAL_COMMISSION_RATE_BPS`：全局返佣比例。
- `REFERRAL_FREEZE_HOURS`：冻结期。
- `REFERRAL_DURATION_DAYS`：绑定后返佣有效期。
- `REFERRAL_PER_INVITEE_CAP_CENTS`：单个被邀请人的累计返佣上限。
- `REFERRAL_COOKIE_TTL_DAYS`：邀请归因 Cookie 有效期。
- `REFERRAL_REWARD_MODE`：MVP 固定为 `credits`。
- `INTERNAL_JOB_REFERRAL_THAW_INTERVAL_MINUTES`：返佣解冻任务间隔。

## 后续扩展

- 管理端审计页：邀请绑定、返佣账本、转积分记录，并可按订单人工取消返佣。
- 管理端用户专属邀请码与专属比例配置。
- 支付平台更丰富的退款/拒付 webhook 事件适配；当前底层 UOL 已提供冲正入口。
