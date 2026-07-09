/**
 * UOL Operations - 全域操作注册桶导入
 *
 * 职责：副作用导入所有域操作文件，触发 defineOperation 注册。
 * 应用启动时由 uol/index.ts 或顶层入口 import 此文件，
 * 确保所有操作在 registry 中可用。
 *
 * 新增域时在此追加 import 即可。
 */

// 用户侧基础操作域
import "./user";
// 管理侧操作域
import "./admin";
// 系统维护操作域
import "./system";
