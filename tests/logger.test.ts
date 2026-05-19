import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isBrowserInfoLogEnabled } from "../src/lib/logger";
import { isServerInfoLogEnabled } from "../server/src/logger";

describe("logger info gates", () => {
  it("enables browser info logs only when the flag is 1", () => {
    /*
     * ========================================================================
     * 步骤1：验证前端 info 日志开关
     * ========================================================================
     * 目标：
     *   1) 只有 VITE_ENABLE_INFO_LOGS=1 才启用 info
     *   2) 避免字符串 0 被 Boolean 误判为启用
     */

    // 1.1 校验开启值
    assert.equal(isBrowserInfoLogEnabled({ VITE_ENABLE_INFO_LOGS: "1" }), true);

    // 1.2 校验关闭值
    assert.equal(isBrowserInfoLogEnabled({ VITE_ENABLE_INFO_LOGS: "0" }), false);
    assert.equal(isBrowserInfoLogEnabled({}), false);
  });

  it("enables server info logs only for LOG_LEVEL info", () => {
    /*
     * ========================================================================
     * 步骤1：验证后端 info 日志开关
     * ========================================================================
     * 目标：
     *   1) LOG_LEVEL=info 时启用 info
     *   2) warn/error 级别下 info 保持早退
     */

    // 1.1 校验开启值
    assert.equal(isServerInfoLogEnabled({ LOG_LEVEL: "info" }), true);

    // 1.2 校验关闭值
    assert.equal(isServerInfoLogEnabled({ LOG_LEVEL: "warn" }), false);
    assert.equal(isServerInfoLogEnabled({}), false);
  });
});
