/**
 * UOL 管理侧操作注册桶。
 *
 * 职责：注册管理员可见的操作定义，并复用用户侧基础操作；不包含系统启动
 * 专用的维护操作入口选择逻辑。
 * 使用方：Admin MCP、管理后台 agent 适配器、全量注册桶。
 * 关键依赖：user.ts 以及各管理领域 operation 模块。
 */

import "./user";
import "./user-auth";
import "./image-backend-pool";
import "./support";
import "./referral";
import "./admin-payments";
