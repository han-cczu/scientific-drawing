export function createId(prefix = "id") {
  /*
   * ========================================================================
   * 步骤1：生成浏览器兼容 ID
   * ========================================================================
   * 目标：
   *   1) 优先使用 crypto.randomUUID
   *   2) 在内置浏览器不支持时使用时间戳和随机数兜底
   */
  // 1.1 优先读取安全随机 UUID
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") {
    return `${prefix}-${randomUUID.call(globalThis.crypto)}`;
  }

  // 1.2 使用兼容兜底
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}-${time}-${random}`;
}
