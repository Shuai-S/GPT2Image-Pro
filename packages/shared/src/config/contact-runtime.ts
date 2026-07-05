/**
 * 公开联系邮箱运行时读取器。
 *
 * 职责：从系统设置读取 CONTACT_EMAIL，并回退到客户端安全的默认邮箱规则。
 * 使用方：服务端组件、路由处理器与 SEO 结构化数据生成逻辑。
 * 关键依赖：system-settings 运行时读取器；该模块会间接访问数据库，禁止从客户端组件导入。
 */

import { getRuntimeSettingString } from "../system-settings";
import { resolveContactEmail } from "./contact";

/**
 * 读取运行时公开联系邮箱。
 *
 * @returns 后台系统设置、环境变量或代码默认值解析出的公开联系邮箱。
 * @sideEffects 正常运行时读取 system_settings 表；构建期可按系统设置规则回退环境变量。
 * @throws DB 访问异常会向上抛出，由调用方所属页面处理。
 */
export async function getRuntimeContactEmail() {
  return resolveContactEmail(await getRuntimeSettingString("CONTACT_EMAIL"));
}
