/**
 * S3 兼容存储提供者
 *
 * 支持 AWS S3、Cloudflare R2、MinIO 等 S3 兼容存储
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  DEFAULT_SIGNED_URL_EXPIRES,
  DEFAULT_UPLOAD_URL_EXPIRES,
  type S3StorageConfig,
  type StorageProvider,
} from "../types";
import { getRuntimeSettingString } from "../../system-settings";

// ============================================
// S3 客户端单例
// ============================================

/**
 * S3 客户端进程级单例
 *
 * 注意：一经创建即永不失效，而端点/凭证/区域均来自运行时设置
 * （getRuntimeSettingString，可经管理后台修改）。轮换密钥或切换端点后，
 * 运行进程仍沿用旧客户端——须重启进程方可生效。
 */
let s3Client: S3Client | null = null;

/**
 * 获取存储配置
 *
 * 从环境变量读取 S3 兼容存储配置
 */
async function getStorageConfig(): Promise<S3StorageConfig> {
  const accessKeyId = await getRuntimeSettingString("STORAGE_ACCESS_KEY_ID");
  const secretAccessKey = await getRuntimeSettingString(
    "STORAGE_SECRET_ACCESS_KEY"
  );
  const endpoint = await getRuntimeSettingString("STORAGE_ENDPOINT");
  const region = (await getRuntimeSettingString("STORAGE_REGION")) ?? "auto";

  // 验证必需的环境变量
  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      "存储配置缺失: 请设置 STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, STORAGE_ENDPOINT 环境变量"
    );
  }

  return {
    accessKeyId,
    secretAccessKey,
    endpoint,
    region,
  };
}

/**
 * 获取 S3 客户端实例 (单例模式)
 *
 * 延迟初始化，避免在模块加载时就检查环境变量
 */
async function getS3Client(): Promise<S3Client> {
  if (!s3Client) {
    const config = await getStorageConfig();

    s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Cloudflare R2 需要的配置
      forcePathStyle: true,
    });
  }

  return s3Client;
}

// ============================================
// S3 存储提供者实现
// ============================================

/**
 * 在硬字节上限内读取 Web ReadableStream。
 *
 * @param stream S3 SDK 转换出的对象正文流。
 * @param maxBytes 可选最大字节数；超限时立即 cancel 流并抛错。
 * @returns 完整对象 Buffer。
 * @sideEffects 消费并关闭输入流；超限时主动中止剩余网络读取。
 * @throws 流读取失败、上限非法或累计正文超限时抛错。
 */
export async function readWebStreamWithLimit(
  stream: ReadableStream<Uint8Array>,
  maxBytes?: number
): Promise<Buffer> {
  if (maxBytes !== undefined && (!Number.isFinite(maxBytes) || maxBytes < 0)) {
    throw new Error("Invalid stored object read limit");
  }
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (maxBytes !== undefined && totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error("Stored object exceeds the configured read limit");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks, totalBytes);
}

/**
 * S3 兼容存储提供者
 *
 * 实现 StorageProvider 接口，支持：
 * - Cloudflare R2
 * - AWS S3
 * - MinIO
 * - 其他 S3 兼容存储
 */
export const s3Provider: StorageProvider = {
  /**
   * 获取签名读取 URL
   *
   * @param key - 文件键名
   * @param bucket - 存储桶名称
   * @param expiresIn - 有效期 (秒)
   * @returns 签名 URL
   */
  async getSignedUrl(
    key: string,
    bucket: string,
    expiresIn: number = DEFAULT_SIGNED_URL_EXPIRES
  ): Promise<string> {
    const client = await getS3Client();

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const signedUrl = await getSignedUrl(client, command, {
      expiresIn,
    });

    return signedUrl;
  },

  /**
   * 获取签名上传 URL
   *
   * @param key - 文件键名
   * @param bucket - 存储桶名称
   * @param contentType - 文件 MIME 类型
   * @param expiresIn - 有效期 (秒)
   * @returns 签名上传 URL
   */
  async getSignedUploadUrl(
    key: string,
    bucket: string,
    contentType: string,
    expiresIn: number = DEFAULT_UPLOAD_URL_EXPIRES
  ): Promise<string> {
    const client = await getS3Client();

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    const signedUrl = await getSignedUrl(client, command, {
      expiresIn,
    });

    return signedUrl;
  },

  /**
   * 删除文件
   *
   * @param key - 文件键名
   * @param bucket - 存储桶名称
   */
  async deleteObject(key: string, bucket: string): Promise<void> {
    const client = await getS3Client();

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await client.send(command);
  },

  /**
   * 获取文件内容
   *
   * @param key - 文件键名
   * @param bucket - 存储桶名称
   * @returns 文件内容 Buffer
   */
  async getObject(
    key: string,
    bucket: string,
    options?: { signal?: AbortSignal; maxBytes?: number }
  ): Promise<Buffer> {
    const client = await getS3Client();

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    // 透传 abortSignal：调用方取消（如缩略图请求被页面切换打断）时，SDK 会
    // 中止进行中的下载并断开连接，立即释放资源。exactOptionalPropertyTypes 下
    // 不能传 abortSignal: undefined，故用条件展开仅在有信号时附带该字段。
    const response = await client.send(
      command,
      options?.signal ? { abortSignal: options.signal } : {}
    );

    if (!response.Body) {
      throw new Error(`File not found: ${key}`);
    }

    const maxBytes = options?.maxBytes;
    if (
      maxBytes !== undefined &&
      response.ContentLength !== undefined &&
      response.ContentLength > maxBytes
    ) {
      throw new Error("Stored object exceeds the configured read limit");
    }

    // ContentLength 可能被兼容存储省略，因此读取流时仍执行硬上限。
    return await readWebStreamWithLimit(
      response.Body.transformToWebStream(),
      maxBytes
    );
  },

  async putObject(
    key: string,
    bucket: string,
    data: Buffer,
    contentType: string
  ): Promise<void> {
    const client = await getS3Client();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    });
    await client.send(command);
  },
};

// ============================================
// 便捷函数导出
// ============================================

/**
 * 获取 S3 存储提供者
 *
 * 当前默认使用 S3 兼容存储
 */
export function getS3StorageProvider(): StorageProvider {
  return s3Provider;
}
