# docker-compose Conventions

> Volume-mount rules that keep image-baked assets visible while still persisting runtime state.

---

## Why This Spec Exists

The project ships two compose files:

- `docker-compose.yml` — single-node production form. The image bakes in `data/eval-suite/` (baseline + sample images, see `Dockerfile:65`). Only the *runtime-mutated* directories (`data/uploads`, `data/exports`) should be persisted on the host.
- `docker-compose.dev.yml` — dev form. The host's source tree is bind-mounted into the container for hot reload. The host's `node_modules` (if any) **must not** shadow the container's.

Both forms have a single non-obvious failure mode: a naive bind mount silently hides what the image built.

---

## Convention: Bind-mount the *subdirectory*, not the parent

**What**: When the image contains `/app/data/eval-suite` (baked at build time) and the host needs to persist `/app/data/uploads`, mount the *child* directories one by one — never `./data:/app/data`.

**Why**: A bind mount replaces the entire target path's contents with the host's. Mounting `./data:/app/data` makes `data/eval-suite` empty inside the container (the host's empty `./data/eval-suite` wins), and `npm run evaluate` fails with "baseline not found" or, worse, regenerates a baseline against an empty sample set.

**Example** — `docker-compose.yml:14`:

```yaml
services:
  app:
    volumes:
      # ✅ child-only mounts; /app/data/eval-suite stays as the image baked it
      - ./data/uploads:/app/data/uploads
      - ./data/exports:/app/data/exports
```

**Don't**:

```yaml
# ❌ This shadows /app/data/eval-suite with an empty host directory.
services:
  app:
    volumes:
      - ./data:/app/data
```

**Decision rule**: If *any* child of `<dir>` is image-baked and read-only at runtime, you can only bind-mount its siblings, never `<dir>` itself.

---

## Convention: Dev-mode source mount needs an anonymous `node_modules` volume

**What**: When `docker-compose.dev.yml` mounts the host source into `/app` for hot reload, declare `- /app/node_modules` as an **anonymous volume** *after* the source mount.

**Why**:
- The container installed `node_modules` for Linux during `docker build`. The host's `node_modules` (Windows / macOS binaries, or absent entirely) is incompatible.
- Without the protector volume, the bind mount of the source tree drags the host's `node_modules` (or its emptiness) over the container's, and `sharp` / native modules immediately fail with "wrong ELF class" or "module not found".
- The anonymous volume sits as a higher-precedence mount on `/app/node_modules`, isolating the container's copy.

**Example** — `docker-compose.dev.yml:14`:

```yaml
services:
  app:
    volumes:
      - .:/app                  # source for hot reload
      - /app/node_modules       # anonymous volume — MUST come after the source mount
      - ./data/uploads:/app/data/uploads
```

**Don't**:

```yaml
# ❌ Order matters too: anonymous volume before the source mount has no effect.
volumes:
  - /app/node_modules
  - .:/app
```

---

## Validation Matrix

| Symptom | Cause | Fix |
|---------|-------|-----|
| Container starts, `/app/data/eval-suite` is empty | Parent dir was bind-mounted | Switch to per-child mounts |
| `npm run evaluate` inside container: "baseline.json not found" | Same as above | Same |
| Dev container: `Error: Cannot find module 'sharp'` immediately after `docker compose up` | Host `node_modules` shadowed the container's | Add `- /app/node_modules` after the source mount |
| Dev container: `sharp` loads but throws "wrong ELF class: ELFCLASS32" | Same as above (host has Windows/macOS native binaries) | Same |

---

## Required Tests / Verification

Before merging a compose change:

1. `docker compose -f docker-compose.yml up -d && docker compose exec app ls /app/data/eval-suite` — must list baseline + samples.
2. `docker compose -f docker-compose.dev.yml up -d && docker compose exec app node -e "require('sharp')"` — must exit 0.
3. Run `npm run evaluate` inside the production container and confirm `normalizedMeanDiffDelta == 0` for every sample. If it isn't, suspect (a) a stray parent-dir mount or (b) the font/base-image rules in `container-image.md`.

---

## Related

- `deployment/container-image.md` — the font / base-image rules that the eval baseline assumes.
- `backend/deterministic-output.md` — the application-side contract this runtime supports.
