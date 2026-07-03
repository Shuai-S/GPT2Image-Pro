/**
 * 模型定价模块出口。
 *
 * 使用方：业务层通过本入口导入定价规则类型、规则解析函数和积分计算函数。模块只做
 * DB-free 纯计算；真正扣费仍必须走 credits/core 中带 sourceRef 的幂等扣费服务。
 * 关键依赖：pricing-resolver。
 */

export * from "./pricing-resolver";
