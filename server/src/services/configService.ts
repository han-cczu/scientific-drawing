import type { SafeAiProviderConfig, TestConfigResult } from "@shared/apiContracts";
import {
  buildSafeAiProviderConfig, fetchOpenAiCompatibleModels, readAiRuntimeConfig
} from "../scene/aiProviderConfig";
import { readPersistedConfig, writePersistedConfig, deletePersistedConfig } from "../storage/aiConfigStore";
import { ConfigValidationError, validateWritableConfig } from "../storage/configValidation";

export function createConfigService(options: {
  configPath: string;
  env: NodeJS.ProcessEnv;
  fetchModels?: typeof fetchOpenAiCompatibleModels;
}) {
  const fetchModels = options.fetchModels ?? fetchOpenAiCompatibleModels;
  const runtime = () => readAiRuntimeConfig(options.env, options.configPath);

  function writableInput(input: unknown) {
    const saved = readPersistedConfig(options.configPath);
    const validation = validateWritableConfig(input, { allowEmptyKey: Boolean(saved?.apiKey) });
    if (!validation.ok) throw new ConfigValidationError(validation.error);
    // A saved key is reusable only at its saved endpoint.
    const apiKey = validation.value.apiKey || (validation.value.baseUrl === saved?.baseUrl ? saved.apiKey : "");
    if (!apiKey) throw new ConfigValidationError("apiKey is required when changing baseUrl.");
    return { ...validation.value, apiKey };
  }

  async function read(): Promise<SafeAiProviderConfig> {
    const config = runtime();
    const modelList = await fetchModels(config);
    return buildSafeAiProviderConfig({ ...config, models: modelList.models, modelListError: modelList.error });
  }

  return {
    runtime,
    read,
    async save(input: unknown) {
      writePersistedConfig(writableInput(input), options.configPath);
      return read();
    },
    async remove() {
      deletePersistedConfig(options.configPath);
      return read();
    },
    async test(input: unknown): Promise<TestConfigResult> {
      // Validation errors remain 400 at the route; upstream test failures remain 200.
      const config = writableInput(input);
      try {
        const result = await fetchModels(config);
        if (result.error) {
          const auth = result.status === 401 || result.status === 403 || /401|403|unauthorized|forbidden|invalid[\s_-]?api[\s_-]?key|authentication/i.test(result.error);
          const code = result.status === -1 ? "INVALID_RESPONSE" : auth ? "AUTH" : "UNKNOWN";
          return { ok: false, code, error: result.error, models: [] };
        }
        return { ok: true, modelCount: result.models.length, models: result.models };
      } catch (error) {
        return { ok: false, code: "NETWORK", error: String(error), models: [] };
      }
    }
  };
}

export type ConfigService = ReturnType<typeof createConfigService>;
