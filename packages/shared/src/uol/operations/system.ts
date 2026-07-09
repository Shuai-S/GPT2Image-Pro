/**
 * UOL 系统维护操作注册桶。
 *
 * 职责：注册仅系统或超级管理员维护入口需要的操作，包含可能访问本地
 * `.env` 文件的系统设置同步逻辑。普通用户端路由不得导入本桶。
 * 使用方：Admin MCP、启动/维护任务、全量注册桶。
 * 关键依赖：system-settings operation 模块。
 */

import "./system-settings";
