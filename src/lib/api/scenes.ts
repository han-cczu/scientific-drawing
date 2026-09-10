import { logger } from "../logger";
import type { Scene } from "../../shared/scene";
import type { AnalyzeResponse, ApiSceneBox, ReconstructionMode, RegionMergeMode, ReconstructRegionRequest } from "../../shared/apiContracts";
import { readAnalyzeResponse } from "./responses";
import { parseReconstructError } from "./errors";
import { imageForm, jsonRequest } from "./transport";

export async function analyzeImage(file: File, signal?: AbortSignal): Promise<AnalyzeResponse> {
  logger.info("开始上传图片并请求分析...", { fileName: file.name });
  const form = imageForm(file);
  const response = await fetch("/api/analyze", {
    method: "POST",
    body: form,
    signal
  });
  if (!response.ok) {
    throw new Error(`Analyze failed: ${response.status}`);
  }
  const payload = await readAnalyzeResponse(response, "图片分析");
  logger.info("上传图片并请求分析完成", { nodes: payload.scene.nodes.length });
  return payload;
}

export async function reconstructImage(file: File, mode: ReconstructionMode, model: string, signal?: AbortSignal): Promise<AnalyzeResponse> {
  logger.info("开始上传图片并请求 AI 重建...", { fileName: file.name, mode, model });
  const form = imageForm(file);
  form.append("mode", mode);
  form.append("model", model);
  const response = await fetch("/api/reconstruct", {
    method: "POST",
    body: form,
    signal
  });
  if (!response.ok) {
    throw await parseReconstructError(response);
  }
  const payload = await readAnalyzeResponse(response, "AI 重建");
  logger.info("上传图片并请求 AI 重建完成", { nodes: payload.scene.nodes.length });
  return payload;
}

export async function reconstructRegion(
  scene: Scene,
  region: ApiSceneBox,
  mode: ReconstructionMode,
  model: string,
  mergeMode: RegionMergeMode,
  signal?: AbortSignal
): Promise<AnalyzeResponse> {
  logger.info("开始请求 AI 局部重建...", { region, mode, model, mergeMode });
  const response = await fetch("/api/reconstruct-region", jsonRequest(
    "POST", { scene, region, mode, model, mergeMode } satisfies ReconstructRegionRequest, signal
  ));
  if (!response.ok) {
    throw await parseReconstructError(response);
  }
  const payload = await readAnalyzeResponse(response, "AI 局部重建");
  logger.info("请求 AI 局部重建完成", { nodes: payload.scene.nodes.length });
  return payload;
}
