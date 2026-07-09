/*
 * 文件职责：验证 Web standalone 镜像中的 sharp 与 ONNX Runtime 原生依赖可加载。
 * 使用方：Dockerfile.web runner 构建阶段，覆盖 amd64 与 arm64 发布产物。
 * 关键依赖：最终 standalone node_modules，禁止从源码工作区回退解析。
 */
const onnxRuntime = require("onnxruntime-node");
const sharp = require("sharp");

/**
 * 执行最小原生模块冒烟验证。
 *
 * @returns {Promise<void>} PNG 编码和 ONNX binding 检查完成后结束。
 * @sideEffects 在内存中编码一张 1×1 PNG，不访问网络或持久化文件。
 * @throws 原生 binding、动态库缺失或 PNG 编码异常时抛出并阻断镜像构建。
 */
async function verifyNativeRuntime() {
  if (typeof onnxRuntime.InferenceSession?.create !== "function") {
    throw new Error("onnxruntime-node native binding is unavailable");
  }

  const png = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();

  if (png.length === 0) {
    throw new Error("sharp produced an empty PNG");
  }
}

verifyNativeRuntime().catch((error) => {
  console.error("[native-runtime-smoke]", error);
  process.exitCode = 1;
});
