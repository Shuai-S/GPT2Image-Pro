/**
 * 服务端时区读取工具
 *
 * 职责：为仍需兼容旧配置的服务端逻辑提供备用时区读取入口。
 * 使用方：遗留服务端兼容逻辑；页面展示不应依赖此入口。
 * 关键依赖：系统设置运行时读取。
 */
import { getRuntimeSettingString } from "../system-settings";
import {
  APP_TIME_ZONE_SETTING_KEY,
  DEFAULT_APP_TIME_ZONE,
  normalizeTimeZone,
} from "./index";

/**
 * 获取应用配置时区。
 *
 * @returns 系统设置中的 IANA 时区，未配置或非法时回退 UTC。
 * @sideEffects 读取系统设置运行时快照。
 * @failureMode 设置非法时返回 DEFAULT_APP_TIME_ZONE，避免服务端渲染抛错。
 */
export async function getAppTimeZone() {
  return normalizeTimeZone(
    await getRuntimeSettingString(APP_TIME_ZONE_SETTING_KEY),
    DEFAULT_APP_TIME_ZONE
  );
}
