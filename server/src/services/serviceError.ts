/** Expected service failures carry public data; unexpected failures use the HTTP fallback. */
export class ServiceError extends Error {
  constructor(public readonly status: number, public readonly body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "Scene operation failed.");
    this.name = "ServiceError";
  }
}
