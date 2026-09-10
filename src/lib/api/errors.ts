import { isReconstructErrorCode, type ReconstructErrorCode } from "../../shared/apiContracts";
import { isRecord } from "./responses";
import { hasJsonContentType } from "./transport";

export class ReconstructApiError extends Error {
  constructor(
    public readonly code: ReconstructErrorCode,
    message: string,
    public readonly hint?: string
  ) {
    super(message);
    this.name = "ReconstructApiError";
  }
}
export async function parseReconstructError(response: Response): Promise<ReconstructApiError> {
  if (!hasJsonContentType(response)) {
    return new ReconstructApiError("NETWORK", `服务返回异常（HTTP ${response.status}）。`);
  }
  try {
    const body: unknown = await response.json();
    const raw = isRecord(body) ? body.error : undefined;
    if (isRecord(raw)) {
      const envelope = raw;
      return new ReconstructApiError(
        isReconstructErrorCode(envelope.code) ? envelope.code : "UNKNOWN",
        typeof envelope.message === "string" ? envelope.message : `HTTP ${response.status}`,
        typeof envelope.hint === "string" ? envelope.hint : undefined
      );
    }
    return new ReconstructApiError("UNKNOWN", typeof raw === "string" ? raw : `HTTP ${response.status}`);
  } catch {
    return new ReconstructApiError("UNKNOWN", `HTTP ${response.status}`);
  }
}
