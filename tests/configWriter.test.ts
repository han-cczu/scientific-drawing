import assert from "node:assert/strict";
import { it } from "node:test";
import { createConfigWriter } from "../src/features/settings/configWriter";
import type { AppConfig } from "../src/shared/apiContracts";

const config: AppConfig = {
  aiReconstructionAvailable: false,
  provider: "openai-compatible",
  baseUrl: "https://example.invalid",
  reconstructModel: "test",
  reconstructModels: [],
  modelListAvailable: false,
  modelListError: null,
  hasApiKey: false,
  source: "none",
  maskedTail: null,
};
const payload = {
  apiKey: "test-placeholder",
  baseUrl: config.baseUrl,
  reconstructModel: "test",
};

it("blocks overlapping save and clear before either can issue a second write", async () => {
  let complete!: (result: AppConfig) => void;
  let saves = 0;
  let clears = 0;
  const pending: boolean[] = [];
  const writer = createConfigWriter(
    {
      save: () => {
        saves++;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
      clear: async () => {
        clears++;
        return config;
      },
    },
    (value) => pending.push(value),
  );
  const first = writer.save(payload);
  await assert.rejects(writer.save(payload), /配置正在保存/);
  await assert.rejects(writer.clear(), /配置正在保存/);
  assert.equal(saves, 1);
  assert.equal(clears, 0);
  assert.deepEqual(pending, [true]);
  complete(config);
  assert.equal(await first, config);
  await writer.clear();
  assert.equal(clears, 1);
  assert.deepEqual(pending, [true, false, true, false]);
});

it("releases the configuration write lock after failure so a retry succeeds", async () => {
  const failure = new Error("disk full");
  const pending: boolean[] = [];
  const writer = createConfigWriter(
    {
      save: async () => {
        throw failure;
      },
      clear: async () => config,
    },
    (value) => pending.push(value),
  );
  await assert.rejects(writer.save(payload), (error) => error === failure);
  assert.equal(await writer.clear(), config);
  assert.deepEqual(pending, [true, false, true, false]);
});
