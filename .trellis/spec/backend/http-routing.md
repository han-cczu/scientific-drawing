# HTTP Routing Conventions

> How `server/src/index.ts` composes the Express app so that API, static, and SPA fallback coexist on a single port — without crashing in dev.

---

## Why This Spec Exists

This project serves a single Express process that simultaneously handles:

1. `/api/*` — REST endpoints (`apiRouter`)
2. `/uploads/*`, `/exports/*` — static asset directories on the host filesystem
3. `/*` — SPA fallback to `dist/index.html` (only when the frontend has actually been built)

Two non-obvious traps live in this composition:
- The SPA catch-all must not eat API paths.
- In dev (no `dist/`), the catch-all must not crash the boot or 404 every request.

The third trap is framework-specific: Express 5 + path-to-regexp v6 changed how the `*` character is parsed in route strings, which broke the previous one-liner.

---

## Convention: Middleware order is API/static first, SPA fallback last

**What**: In `server/src/index.ts`, the registration order is fixed:

```typescript
app.use(cors());
app.use("/uploads", express.static(uploadDir));
app.use("/exports", express.static(exportDir));
app.use("/api", apiRouter);
// ... only then ...
if (distAvailable) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/|uploads\/|exports\/).*/, (_req, res) => {
    res.sendFile(distIndex);
  });
}
```

**Why**: Express matches handlers in registration order. If the SPA fallback is registered first, `GET /api/scenes` returns `index.html` and the frontend silently breaks. The negative-lookahead in the RegExp is a **second** line of defense — the order is the primary one. Both belong; don't drop either.

---

## Convention: SPA fallback uses a RegExp, not a string pattern

**What**: The fallback handler uses

```typescript
app.get(/^\/(?!api\/|uploads\/|exports\/).*/, handler);
```

not

```typescript
// ❌ Express 5 / path-to-regexp v6 cannot parse a bare `*` as "match anything"
app.get("*", handler);
```

**Why**: Express 5 upgraded `path-to-regexp` from v0.x to v6, which made `*` and `(.*)` syntactically invalid in route strings (they now require a name, e.g. `*splat`). The fix isn't to chase the new syntax — it's to drop into a RegExp, which path-to-regexp passes through unchanged. This also gives us the negative-lookahead for free.

**Gotcha**: This bug is silent at install time. It only surfaces when a request arrives and Express throws `TypeError: Missing parameter name`. Tests that only hit `/api/*` won't catch it. Verify with at least one `GET /` test.

---

## Convention: Guard the fallback with `existsSync(distIndex)`

**What**:

```typescript
const distIndex = path.join(distDir, "index.html");
const distAvailable = existsSync(distIndex);
logger.info("前端静态资源目录检测完成", { distDir, distAvailable });

if (distAvailable) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/|uploads\/|exports\/).*/, /* ... */);
}
```

**Why**: The same `server/src/index.ts` runs in three contexts:

| Context | `dist/` exists? | What should happen |
|---------|-----------------|--------------------|
| Production container (after `npm run build`) | Yes | Fallback registered, SPA served |
| Local dev (Vite on :5173 proxies to API) | No | Fallback **not** registered, `/` returns 404 cleanly |
| Tests (`vitest`, no build step) | No | Same as dev |

Without the guard, `sendFile` would fire against a non-existent path on every `/` hit during dev, and `express.static(distDir)` would log warnings on every request. The boot-time `logger.info` line is intentional — it tells the operator immediately which mode they're in.

---

## Validation Matrix

| Condition | Expected Behavior |
|-----------|-------------------|
| `dist/index.html` exists, `GET /api/scenes` | Hits `apiRouter`, never the fallback |
| `dist/index.html` exists, `GET /any/spa/route` | Returns `index.html` (200) |
| `dist/index.html` exists, `GET /uploads/foo.png` | Served by `express.static`, never the fallback |
| `dist/index.html` missing, `GET /` | 404 from Express default — fallback not registered |
| `dist/index.html` missing, `GET /api/scenes` | Hits `apiRouter` normally |

---

## Required Tests

- A boot test that imports `app` with no `dist/` and asserts `GET /` returns 404 (not a crash). This catches the path-to-regexp regression.
- A boot test with a fake `dist/index.html` and asserts `GET /any/spa/route` returns the index.

---

## Wrong vs Correct

### Wrong

```typescript
// Boot crashes on Express 5: "TypeError: Missing parameter name at 1: ..."
app.get("*", (_req, res) => res.sendFile(distIndex));

// Also wrong: registered before /api, so /api/* never reaches the router
app.get(/^\/.*/, (_req, res) => res.sendFile(distIndex));
app.use("/api", apiRouter);

// Also wrong: no guard → dev/test boot tries to sendFile a missing index.html on every /
app.get(/^\/(?!api\/|uploads\/|exports\/).*/, (_req, res) => res.sendFile(distIndex));
```

### Correct

```typescript
app.use("/uploads", express.static(uploadDir));
app.use("/exports", express.static(exportDir));
app.use("/api", apiRouter);

const distIndex = path.join(distDir, "index.html");
if (existsSync(distIndex)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/|uploads\/|exports\/).*/, (_req, res) => {
    res.sendFile(distIndex);
  });
}
```

---

## Related

- `deployment/container-image.md` — the container is what makes `dist/` exist at runtime.
- `deployment/docker-compose.md` — dev compose runs without `dist/` and relies on this guard.
