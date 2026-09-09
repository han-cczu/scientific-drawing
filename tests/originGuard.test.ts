import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAllowedMutationOrigin } from "../server/src/routes/originGuard";

describe("isAllowedMutationOrigin (CSRF 状态变更来源校验)", () => {
  it("放行无 Origin/Referer 的非浏览器请求（curl/CLI）", () => {
    assert.equal(isAllowedMutationOrigin("", "example.com:8787"), true);
  });

  it("放行本机回环来源（含 dev 跨端口与 IPv6）", () => {
    assert.equal(isAllowedMutationOrigin("http://localhost:5173", "localhost:8787"), true);
    assert.equal(isAllowedMutationOrigin("http://127.0.0.1:5173", "localhost:8787"), true);
    assert.equal(isAllowedMutationOrigin("http://[::1]:5173", "example.com:8787"), true);
  });

  it("放行与 Host 同主机的来源（含同源 prod 与 LAN 部署）", () => {
    assert.equal(isAllowedMutationOrigin("http://example.com:8787", "example.com:8787"), true);
    assert.equal(isAllowedMutationOrigin("http://192.168.1.5:8787", "192.168.1.5:8787"), true);
    // 端口不同但主机相同也放行（仅比主机名）
    assert.equal(isAllowedMutationOrigin("http://example.com", "example.com:8787"), true);
  });

  it("拒绝跨站来源（CSRF 攻击页）", () => {
    assert.equal(isAllowedMutationOrigin("https://evil.com", "example.com:8787"), false);
    assert.equal(isAllowedMutationOrigin("https://evil.com:8787", "example.com:8787"), false);
  });

  it("拒绝畸形 / null Origin", () => {
    assert.equal(isAllowedMutationOrigin("null", "example.com:8787"), false);
    assert.equal(isAllowedMutationOrigin("not a url", "example.com:8787"), false);
  });
});
