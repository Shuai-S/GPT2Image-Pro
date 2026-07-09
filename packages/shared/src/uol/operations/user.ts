/**
 * UOL 用户侧操作注册桶。
 *
 * 职责：只注册终端用户、API Key 与用户 MCP 需要的操作定义，避免把管理
 * 维护操作的文件系统逻辑追踪进普通用户端路由 bundle。
 * 使用方：用户 MCP、站内用户 agent 入口，以及全量注册桶。
 * 关键依赖：各领域 operation 模块的副作用注册。
 */

import "./image-generation";
import "./editable-file";
import "./credits";
import "./model-pricing";
import "./subscription";
import "./external-api";
import "./storage";
import "./moderation";
