# Container Image Conventions

> Base image and system-package choices that keep `sharp`, font rendering, and the eval baseline reproducible.

---

## Why This Spec Exists

The eval suite asserts pixel/SSIM deltas against `data/eval-suite/baseline.json`. Two things silently shift those metrics:

1. The `sharp` / `libvips` build that ships with the base image (Alpine ships musl-linked stubs and forces a source rebuild of libvips; Debian-slim ships a binary that matches what CI uses).
2. The system fonts available at rasterization time. If the container is missing `fonts-noto-cjk`, every CJK glyph falls back to a `.notdef` box and the baseline drifts.

Both have bitten this project. The rules below are the canonical answer.

---

## Convention: Base image is `node:20-bookworm-slim`

**What**: Both builder and runtime stages of `Dockerfile` use `node:20-bookworm-slim` (Debian, glibc).

**Why**:
- `sharp` ships prebuilt binaries for glibc Linux. On `node:20-alpine` (musl), the postinstall has to compile `libvips` from source — slow, fragile, and the resulting binary still produces subtly different output for some operations.
- CI runners are glibc. Keeping the container on glibc means "passes locally in Docker" implies "passes on CI" for the eval suite.
- Debian-slim is ~80 MB heavier than Alpine, which is acceptable; we are not running this at FaaS scale.

**Example** — `Dockerfile:7` and `Dockerfile:40`:

```dockerfile
FROM node:20-bookworm-slim AS builder
# ...
FROM node:20-bookworm-slim AS runtime
```

**Don't**:
- Don't switch to `node:20-alpine` "to shrink the image". The 80 MB cost is intentional.
- Don't pin to `node:20` (full) either — the slim variant is already glibc; the only thing the full variant adds is build tools we install explicitly below.

---

## Convention: Install fonts in the runtime stage AND in CI

**What**: Both the runtime image and the CI workflow install the same font set: `fonts-noto-cjk` and `fonts-liberation`.

**Why**:
- `sharp` / `librsvg` rasterizes text using whatever fonts fontconfig finds on the host. No system fonts → fallback boxes → different pixels → baseline drift.
- The baseline is generated on CI. If the container has a different font set, `npm run evaluate` inside the container will disagree with the baseline even though nothing in code changed.
- We pick `fonts-noto-cjk` (covers Chinese/Japanese/Korean glyphs used by labels) and `fonts-liberation` (metrically compatible with Arial/Times/Courier — the Western fallbacks SVG defaults to).

**Example** — `Dockerfile:50`:

```dockerfile
FROM node:20-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-noto-cjk \
        fonts-liberation \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*
```

And in `.github/workflows/ci.yml` the same `apt-get install -y fonts-noto-cjk fonts-liberation` line must exist before any step that runs `npm run evaluate` or any sharp-rendering test.

---

## Validation Matrix

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `npm run evaluate` clean locally on Docker but `normalizedMeanDiffDelta` > 0 on CI | Image and CI on different font sets | Diff `fc-list` between the two; mirror packages |
| `docker build` takes 5+ minutes on the `npm ci` step | Switched to Alpine; libvips is recompiling | Revert to `node:20-bookworm-slim` |
| Chinese labels render as boxes inside the container | `fonts-noto-cjk` missing | Add to the runtime stage's `apt-get install` |

---

## Wrong vs Correct

### Wrong

```dockerfile
# ❌ Alpine: musl, no prebuilt libvips, no fonts
FROM node:20-alpine AS runtime
RUN npm ci --omit=dev
# eval suite passes baseline only by accident — and breaks the day fontconfig probes differently
```

### Correct

```dockerfile
FROM node:20-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-liberation ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
```

---

## Related

- `backend/deterministic-output.md` — application-level determinism patterns that assume this runtime baseline.
- `.github/workflows/ci.yml` — must stay in sync with the font set installed here.
