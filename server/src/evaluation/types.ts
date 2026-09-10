export type SampleResult = {
  file: string;
  width: number;
  height: number;
  nodes: number;
  editableNodes: number;
  edges: number;
  typeSummary: string;
  meanDiff: number | null;
  normalizedMeanDiff: number | null;
  psnr: number | null;
  ssim: number | null;
  normalizedMeanDiffDelta: number | null;
  ssimDelta: number | null;
  lockedNodes: number;
  imageNodes: number;
  textNodes: number;
  shapeNodes: number;
  edgeEndpointIssues: number;
  modeResults: EvaluationModeResult[];
};

export type SceneComplexity = {
  lockedNodes: number;
  imageNodes: number;
  textNodes: number;
  shapeNodes: number;
  edgeEndpointIssues: number;
};

export type EvaluationManifest = {
  version: number;
  samples: Array<{
    file: string;
    category?: string;
    expectedNodes?: number;
    expectedEdges?: number;
    sourceMd5?: string;
    notes?: string;
  }>;
};

export type EvaluationBaselineEntry = {
  file: string;
  normalizedMeanDiff?: number | null;
  ssim?: number | null;
};

export type EvaluationBaseline = {
  version: number;
  results: EvaluationBaselineEntry[];
};

export type EvaluationBaselineDelta = {
  normalizedMeanDiffDelta: number | null;
  ssimDelta: number | null;
};

export type EvaluationMode = "heuristic" | "ai";

export type EvaluationModeResult = {
  mode: EvaluationMode;
  file: string;
  latencyMs: number;
  success: boolean;
  error?: string;
  estimatedCostUsd: number | null;
};

export type EvaluationIssue = {
  code: string;
  file?: string;
  message: string;
};

export type EvaluationFailure = {
  file: string;
  stage: "sample" | "ai";
  error: string;
};

export type EvaluationValidation = {
  ok: boolean;
  issues: EvaluationIssue[];
};

export type EvaluationReport = {
  generatedAt: string;
  environment: {
    platform: string;
    arch: string;
    node: string;
    renderer: Record<string, string>;
    fonts: { configFile: string | null; configPath: string | null; selection: string };
  };
  source: "manifest" | "uploads";
  expectedFiles: string[];
  aiEnabled: boolean;
  results: SampleResult[];
  failures: EvaluationFailure[];
  validation: EvaluationValidation;
};
