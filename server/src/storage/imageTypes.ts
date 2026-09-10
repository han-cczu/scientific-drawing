const IMAGE_EXTENSIONS_BY_MIME = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"]
]);

export function isAllowedImageMime(mime: string) { return IMAGE_EXTENSIONS_BY_MIME.has(mime); }
export function extensionFromMime(mime: string) { return IMAGE_EXTENSIONS_BY_MIME.get(mime) ?? ".png"; }
