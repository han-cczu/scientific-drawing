# Deterministic Output Patterns

> Patterns for producing byte-stable, diffable backend artifacts (scene snapshots, evaluation reports, fixtures).

---

## Why This Spec Exists

Whenever a backend pipeline produces a JSON/SVG artifact that is checked into git, asserted by tests, or fed into a regression diff, **any non-determinism in that artifact poisons the downstream contract**:

- `git diff` becomes noise; reviewers can't tell what actually changed.
- "deep-equal between two runs" tests turn flaky.
- Regression baselines (e.g. `data/eval-suite/baseline.json`) can never be trusted.

The three patterns below are the project's standard answers. Apply them whenever you add a new artifact-producing path.

> **Runtime prerequisite**: these patterns assume the container base image and font set described in `../deployment/container-image.md`. A wrong base image (Alpine instead of Debian-slim) or missing `fonts-noto-cjk` will drift the baseline regardless of how clean the application-level code is.

---

## Pattern: Content-Hashed IDs Instead of Random UUIDs

**Problem**: A pipeline mints node/element IDs with `uuidv4()` (or `Math.random`). Re-running on the same input produces different IDs — artifacts can't be diffed, React keys remount on every reload.

**Solution**: Derive the ID deterministically from the element's stable identifying fields (geometry, type, role). Use a short SHA1 digest as the suffix.

**Example** — `server/src/scene/analyzeImage.ts:137`:

```typescript
import { createHash } from "node:crypto";

const idDigest = createHash("sha1")
  .update(`${element.type}:${x}:${y}:${w}:${h}`)
  .digest("hex")
  .slice(0, 8);
const id = `${element.type}-${idDigest}`;
```

**Why this works**:
- Same input → same id, across machines, across runs.
- Adding/removing one element does **not** shift the IDs of unrelated elements (unlike `${type}-${index}`).
- Changes to non-identifying fields (e.g. text content, style) do not invalidate the id — React keys stay stable.

**Prerequisites & caveats**:
- The fields you hash must be the **identity** of the element. If two distinct elements can share the same identity, dedupe them **before** assigning IDs (see `dedupeElements` upstream of the analyze loop).
- Quantize floats first (`round(element.x)` etc.). A raw `0.1 + 0.2` will produce platform-dependent hashes.
- Use `node:crypto` — no new dependency, no `uuid` import needed for these IDs.

**Don't**:
```typescript
// ❌ random suffix — artifact differs every run
id: `${element.type}-${index + 1}-${uuidv4().slice(0, 8)}`
// ❌ index-only — inserting one element shifts everyone else's id
id: `${element.type}-${index}`
```

---

## Pattern: `stripVolatileFields` Before Snapshot Write

**Problem**: An artifact carries a legitimate provenance field (`metadata.createdAt`, `generatedAt`, build hash, etc.) that the **business path** needs but the **evaluation/snapshot path** must not contain — otherwise every run diffs.

**Solution**: Keep the production code path untouched. Centralize a `stripVolatileFields(artifact)` helper in the evaluation/snapshot writer. Call it immediately before `fs.writeFile`.

**Example** — `server/src/evaluate.ts:145` + `:354`:

```typescript
export function stripVolatileFields(scene: Scene): Scene {
  const { metadata, ...rest } = scene;
  const { createdAt, ...stableMetadata } = metadata ?? {};
  return { ...rest, metadata: stableMetadata };
}

// at write site:
await fs.writeFile(
  scenePath,
  JSON.stringify(stripVolatileFields(scene), null, 2),
  "utf-8",
);
```

**Why this shape (and not the alternatives)**:
- **Don't** change `analyzeImage` to skip `createdAt` — the business pipeline (upload → analyze → edit) wants the timestamp for audit/debugging.
- **Don't** post-process JSON with a regex — fragile; reorders fields; can match the wrong substring.
- A single chokepoint helper means future volatile fields (e.g. a new `lastRunNs`) get one line added in one place, and every snapshot writer benefits.

**Required tests**:
- Two consecutive `npm run evaluate` runs produce byte-identical `.scene.json` for every sample (after `stripVolatileFields`). See `tests/analyzeImageDeterminism.test.ts`.

**When to extend**:
- New volatile field appears? Add it to `stripVolatileFields`, not to a new helper.
- New artifact type (e.g. svg dump)? Add a sibling `stripVolatileSvgFields` only if the field set genuinely differs; otherwise reuse.

---

## Pattern: CI-Strict, Local-Lenient Threshold Gating

**Problem**: A regression check (delta vs baseline, perf threshold, snapshot match) is meaningful on the canonical CI environment but produces false positives locally (different OS, different `sharp` font fallback, different CPU). If it fails locally, developers learn to ignore it — and then ignore real CI failures too.

**Solution**: Always **compute and print** the deltas locally. Only **exit non-zero** when `process.env.CI === "true"`. The baseline file is the CI snapshot, single source of truth.

**Example** — `server/src/evaluate.ts:88` + `:140`:

```typescript
// Thresholds: one place, easy to tune later.
const MAX_NORMALIZED_MEAN_DIFF_DELTA = 0;
const MIN_SSIM_DELTA = 0;

// ... after computing per-sample deltas and printing summary ...

const violations: string[] = [];
for (const result of results) {
  if (result.normalizedMeanDiffDelta != null
      && result.normalizedMeanDiffDelta > MAX_NORMALIZED_MEAN_DIFF_DELTA) {
    violations.push(
      `${result.file}: normalizedMeanDiffDelta=${result.normalizedMeanDiffDelta} > ${MAX_NORMALIZED_MEAN_DIFF_DELTA}`,
    );
  }
  if (result.ssimDelta != null && result.ssimDelta < MIN_SSIM_DELTA) {
    violations.push(`${result.file}: ssimDelta=${result.ssimDelta} < ${MIN_SSIM_DELTA}`);
  }
}

if (violations.length > 0) {
  logger.error({ violations }, "evaluation regression detected");
  if (process.env.CI === "true") {
    process.exit(1);
  }
}
```

**Why this shape**:
- Local developers always see the delta in their terminal — the signal isn't suppressed, only the exit code is.
- A regression that only shows on CI Linux still fails the PR (CI sets `CI=true`).
- Thresholds are top-level constants, not buried in conditionals — one-line tuning when the platform shifts under us.

**Required conventions**:
- The authoritative baseline file is generated on CI and committed from a CI artifact. Do not commit a baseline regenerated locally on Windows/macOS — it will diverge from the next CI run.
- Threshold constants live at the top of the script (not in a config file) until there's a second consumer; YAGNI.

**Don't**:
- Don't gate the regression check on a custom env var (`STRICT=1`) — developers won't set it, CI failures will surprise them.
- Don't make local runs exit non-zero "to be safe" — developers will start passing `|| true` and the gate is dead.
- Don't maintain a per-OS baseline (`baseline.linux.json`, `baseline.windows.json`) until you have evidence both are needed; the deterministic-output patterns above usually eliminate platform drift first.

---

## Checklist: Adding a New Artifact-Producing Path

Before merging, verify:

- [ ] All IDs/keys in the artifact are derived from input content, not random or wall-clock.
- [ ] All timestamps/build-metadata in the artifact are either (a) absent or (b) stripped by `stripVolatileFields` on the snapshot write path.
- [ ] If the artifact is asserted against a baseline: the regression gate exits non-zero **only** under `CI=true`; local runs print but don't fail.
- [ ] At least one test runs the pipeline twice and asserts byte-equality (or `deep.equal`) of the stripped output.
