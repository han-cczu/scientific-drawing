import { logger } from "../logger";

export function hasJsonContentType(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}

export function jsonRequest(method: string, payload: unknown, signal?: AbortSignal): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal };
}

export function imageForm(file: File): FormData {
  const form = new FormData();
  form.append("image", file);
  form.append("title", file.name);
  return form;
}

export async function readValidatedJson<T>(
  response: Response,
  action: string,
  parse: (value: unknown) => T | null
): Promise<T> {
  if (!hasJsonContentType(response)) {
    logger.warn(`${action}响应非 JSON`, { status: response.status });
    throw new Error(`${action}响应格式异常（HTTP ${response.status}）。`);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    logger.warn(`${action}响应 JSON 解析失败`, { status: response.status, error: String(error) });
    throw new Error(`${action}响应 JSON 解析失败（HTTP ${response.status}）。`);
  }
  const payload = parse(data);
  if (payload === null) {
    logger.warn(`${action}响应结构非法`, { status: response.status });
    throw new Error(`${action}响应格式异常（HTTP ${response.status}）。`);
  }
  return payload;
}
