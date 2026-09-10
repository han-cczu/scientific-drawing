export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Some browsers start downloading after the click handler has returned.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
