-- 普通 image/video async 的 HTTP Idempotency-Key 数据库兜底。
--
-- WHY：应用层会在写媒体前查找 winner，但两个并发请求仍可能同时查无并插入。
-- per-user + per-api-key + task_type + client_request_id 唯一索引只约束显式提供 key 的
-- 普通 generation 任务。v1 普通 generation 必须来自已鉴权 API Key，显式排除
-- api_key_id 为空的非 v1 历史/内部行，避免依赖 PostgreSQL 的 NULL distinct 语义；
-- 无幂等 key 请求与 editable_file 的既有幂等维度均保持不变。
--
-- 上线前可选排查（新功能启用前理论上为空）：
-- SELECT user_id, api_key_id, task_type, client_request_id, count(*)
-- FROM external_async_task
-- WHERE task_type IN ('image', 'video')
--   AND api_key_id IS NOT NULL
--   AND client_request_id IS NOT NULL
-- GROUP BY user_id, api_key_id, task_type, client_request_id
-- HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "external_async_task_generation_client_unique"
  ON "external_async_task" (
    "user_id",
    "api_key_id",
    "task_type",
    "client_request_id"
  )
  WHERE "task_type" IN ('image', 'video')
    AND "api_key_id" IS NOT NULL
    AND "client_request_id" IS NOT NULL;
