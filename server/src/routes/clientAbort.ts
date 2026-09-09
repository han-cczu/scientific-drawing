import type { Response } from "express";

export function observeClientAbort(res: Response) {
  const controller = new AbortController();
  // Request 'close' also fires when the body is consumed. Response 'close' with
  // no completed response is the disconnect that should cancel upstream work.
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  res.on("close", onClose);
  return { signal: controller.signal, dispose: () => res.off("close", onClose) };
}
