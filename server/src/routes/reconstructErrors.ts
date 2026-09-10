import { ReconstructError, type ReconstructErrorCode } from "../scene/reconstructWithOpenAI";

export function toReconstructEnvelope(error: unknown): {
  status: number;
  code: ReconstructErrorCode | "UNKNOWN";
  message: string;
  hint?: string;
} {
  if (error instanceof ReconstructError) {
    const statusByCode: Record<ReconstructErrorCode, number> = {
      AUTH: 401,
      INVALID_IMAGE: 400,
      TIMEOUT: 504,
      BAD_MODEL_OUTPUT: 502,
      INVALID_SCENE: 500,
      NETWORK: 502,
      UPSTREAM: 502
    };
    return { status: statusByCode[error.code], code: error.code, message: publicReconstructMessage(error.code), hint: error.hint };
  }
  return { status: 500, code: "UNKNOWN", message: error instanceof Error ? error.message : String(error) };
}

function publicReconstructMessage(code: ReconstructErrorCode) {
  switch (code) {
    case "AUTH":
      return "AI reconstruction authentication failed.";
    case "INVALID_IMAGE":
      return "Invalid image data.";
    case "TIMEOUT":
      return "AI reconstruction timed out.";
    case "BAD_MODEL_OUTPUT":
      return "Model output could not be parsed.";
    case "INVALID_SCENE":
      return "Generated scene is invalid.";
    case "NETWORK":
      return "Could not connect to model service.";
    case "UPSTREAM":
      return "Model service returned an error.";
  }
}

export function isClientAbort(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function isInvalidImageDataError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /Input file contains unsupported image format|Input buffer contains unsupported image format|unsupported image format/i.test(error.message);
}
