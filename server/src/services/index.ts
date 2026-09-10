import { defaultDataPaths, resolveLocalAssetPath, type DataPaths } from "../paths";
import { analyzeImage } from "../scene/analyzeImage";
import { fetchOpenAiCompatibleModels } from "../scene/aiProviderConfig";
import { reconstructWithOpenAI } from "../scene/reconstructWithOpenAI";
import { createSceneStore, type SceneFileSystem } from "../storage/sceneStore";
import { createAnalyzeService } from "./analyzeService";
import { createConfigService } from "./configService";
import { createExportService } from "./exportService";
import { createReconstructionService, type ReconstructionRunner } from "./reconstructionService";

export type ServiceOptions = {
  paths?: DataPaths;
  env?: NodeJS.ProcessEnv;
  files?: SceneFileSystem;
  analyze?: typeof analyzeImage;
  reconstruct?: ReconstructionRunner;
  fetchModels?: typeof fetchOpenAiCompatibleModels;
};

export function createServices(options: ServiceOptions = {}) {
  const paths = options.paths ?? defaultDataPaths;
  const store = createSceneStore(paths, options.files);
  const config = createConfigService({ configPath: paths.configPath, env: options.env ?? process.env, fetchModels: options.fetchModels });
  const reconstruct = options.reconstruct ?? ((input) => reconstructWithOpenAI(input, config.runtime()));
  return {
    paths,
    store,
    config,
    analyze: createAnalyzeService(store, options.analyze),
    reconstruction: createReconstructionService(store, reconstruct),
    exportScene: createExportService((source) => resolveLocalAssetPath(source, paths))
  };
}

export type Services = ReturnType<typeof createServices>;
