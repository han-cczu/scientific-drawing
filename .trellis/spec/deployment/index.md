# Deployment Guidelines

> Patterns for packaging and running this project (Docker, docker-compose, native fonts/runtime).

---

## Why This Layer Exists

The backend pipeline (sharp-driven image analysis, font-sensitive SVG/PNG rasterization, baseline-asserted regression eval) is **infrastructure-sensitive**: a wrong base image or a wrong volume mount silently changes pixel output, which then changes `data/eval-suite/baseline.json`, which then breaks `npm run evaluate` for everyone. The specs in this directory encode the choices that keep image + container + CI behavior bit-identical.

Companion: `backend/deterministic-output.md` describes how the *application* stays deterministic; this directory describes how the *runtime* stays deterministic.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Container Image Conventions](./container-image.md) | Base image (`node:20-bookworm-slim`), system fonts, why not Alpine | Filled |
| [docker-compose Conventions](./docker-compose.md) | Bind-mount granularity, dev `node_modules` anonymous volume | Filled |

---

## Checklist: Touching the Dockerfile or compose files

- [ ] Did you keep the base image as `node:20-bookworm-slim` (glibc) for both builder and runtime stages?
- [ ] Did you install `fonts-noto-cjk` + `fonts-liberation` in the runtime stage (and mirror it in CI)?
- [ ] If you added a new persisted directory under `/app/data/`, did you mount it as a **subdirectory** bind, not as `./data:/app/data`?
- [ ] If you added source bind mounts for dev, did you protect `node_modules` with an anonymous volume?

---

**Language**: All documentation in **English**.
