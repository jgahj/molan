# Generation Architecture

## Source Of Truth

- PostgreSQL is the canonical cloud state.
- SQLite is the durable local state.
- IndexedDB is the browser write-ahead buffer.
- Memory is a cache; frontend state is a projection.
- Story State is the canonical story fact source.
- Generation Run is the canonical generation task source.

## Generation Rules

1. Official chapter generation has one server entry point.
2. Models return content and findings; server code selects state transitions.
3. Genre and Style are resolved independently.
4. AI Flavor is a risk signal, not a literary quality score.
5. Benchmark similarity is not a quality score.
6. Audit findings require text evidence before revision.
7. Local revision is preferred and limited to two rounds.
8. Manuscript, state, audit, billing and generation receipts commit atomically where the repository supports it.
9. Unknown provider outcomes are never retried automatically.
10. Optimizations require engineering, literary, genre, style, originality, stability and cost gates.
11. Source books are converted to mechanisms and evidence before writer context is built.
12. Production rollout starts with Generation V2 disabled and advances through measured canaries.

## Baselines And Long-form Runs

- `npm run baseline:build` records the source hashes from the commit named by `data/evolution/baseline/code-manifest.json`, including a separate UI source manifest.
- `npm run soak:run -- --manifest <manifest.json> --adapter <generation-v2-adapter.mjs> --state <soak.sqlite> --milestone 3|10|20|50|100` runs audited chapters serially and stores resumable state in SQLite.
- A Soak adapter exports `generateChapter`, `auditChapter`, and, for milestones of 10 chapters or more, `measureCheckpoint`. It should route generation through the official Generation V2 entry point and use the supplied idempotency key and fencing token.
- Soak resumes only with the same replay manifest and adapter hash. Unknown provider outcomes require an adapter `recoverUnknown` implementation before the runner can continue.

## PostgreSQL Backup And Release

- Set `MOLAN_PG_BACKUP_DIR` to a protected directory outside the checkout. `npm run db:pg:backup -- --kind daily|predeploy` creates a custom-format `pg_dump`, validates its archive index, and writes a SHA-256 manifest.
- `npm run db:pg:apply` now requires a valid `pg_dump` backup before applying pending migrations. The backup directory must be available and writable before a migration window starts.
- Schedule the daily command with the deployment platform or Windows Task Scheduler. Managed PostgreSQL must also enable continuous WAL archiving/PITR with an agreed retention period; logical dumps do not provide point-in-time recovery.
- Monthly restore drills use a newly provisioned empty database named `molan_restore_drill_<date>`, `MOLAN_PG_RESTORE_TARGET_URL` (or the corresponding target host/database/user/password variables), and `npm run db:pg:restore-drill -- --dump <backup.dump>`. The command checks the dump hash, refuses non-drill database names and never runs `pg_restore --clean`; the operator removes the drill database after recording the smoke-check result.
- Before deployment, create a `predeploy` backup and keep it with the release manifest. Generation V2 remains disabled until compatibility, security, blind-review and rollback-target gates pass. Increase `MOLAN_GENERATION_V2_PERCENT` through 1, 10, 50 and 100 only after the current canary meets its regression gates; setting `MOLAN_GENERATION_V2=0` or `MOLAN_GENERATION_V2_FORCE_OFF=1` trips the runtime fail-closed kill switch to block formal chapter generation with an explicit notice rather than falling back to the legacy unvetted benchmark chain.
- `lib/generation/rollout-policy.js` fails closed when metric evidence is missing or undersampled and trips the runtime kill switch when provider-unknown, commit-conflict, empty-output, billing-failure, state-drift or literary-regression rates cross configured deltas. Tripping the kill switch halts formal chapter generation tasks fail-closed; a deployment controller must distribute the kill switch to every replica; process-local environment mutation alone is not a multi-instance control plane.

## Production Convergence (P0, P1, P2 Overhaul)

### Implemented Architecture & Behaviors
1. **Production Entry Convergence (P0)**:
   - `sendEditorAI` for chapter generation tasks strictly routes to `runChapterWorkflowV2` (`POST /api/generation-runs`).
   - Legacy `/api/benchmark/generate` path in the editor is completely decoupled from formal manuscripts. Benchmark routes serve purely as read-only shadow evaluation tools.
   - When Generation V2 capabilities are disabled or unavailable, generation halts fail-closed with zero fallback to unvetted benchmark pipelines.

2. **Canonical Genre Route Index & Parameterized Scene Planning (P0)**:
   - `lib/genre/genre-route-index.js` acts as the single source of truth for all 9 narrative families and 21 sub-routes.
   - `lib/style-detector.js` routes reverse lookup via `findFamilyByRoute` instead of broken ad-hoc inspection.
   - `lib/scene-planner.js` replaces hardcoded transition and breathing constants with parameterized `pacingPolicy` (`transitionRange`, `breathingRange`, `actionDensity`), adapting flexibly to different commercial and literary genres.

3. **Engineering Stability & Guardrails (`lib/stability/`) (P1)**:
   - **Provider Circuit Breaker (`circuit-breaker.js`)**: Tracks failure rates in rolling windows; fast-fails during upstream 5xx/timeout outages (`CIRCUIT_BREAKER_OPEN`, HTTP 503) and probes recovery via `HALF_OPEN`.
   - **Project Concurrency Lock (`concurrency.js`)**: Limits each project to max 1 active generation run and 1 revision with auto-expiring TTL locks, preventing state corruption (`CONCURRENCY_LOCKED`, HTTP 409).
   - **Deadline & Timeout Monitor (`deadline.js`)**: Enforces global 10-minute run deadline and individual stage limits (writer, audit, revision) to eliminate infinite hangs (`STAGE_TIMEOUT`, `RUN_TIMEOUT`, HTTP 504).
   - **Centralized Error Catalog (`error-catalog.js`)**: Maps all error codes to HTTP status, retryability flags, user messages, and resolution guidance.

4. **Context Manifest Ledger & Multi-Tier Caching (P1)**:
   - `lib/generation/context.js` records explicit block-level ledger (`{ id, layer, tokens, included, reason }`) in `replayManifest.blocks`.
   - `lib/generation/manifest.js` enriches generation manifests with `styleBundleHash` and `genreBundleHash`.
   - Caching layer (`canon-cache.js`, `style-profile-cache.js`, `genre-baseline-cache.js`) caches world bibles, style profiles, and genre mechanisms using deterministic keys with LRU eviction and TTL expiration.

5. **Quality Gate Fail-Closed & Dual Semantic Review (P1)**:
   - `lib/generation/quality-gate.js` strictly blocks proxy metrics, heuristic presence, and absence claims.
   - `lib/quality/dual-judge.js` enforces dual independent judge reviews: score disparity $> 0.18$ or pass/fail conflict triggers `needs_human` (`DUAL_JUDGE_DISCREPANCY`). Consensus aligns and averages scores.
   - `lib/style/human-texture.js` (Human Texture v2) detects AI clichés, formulaic rhythms, and outputs precision micro-patch replacement windows.
   - `lib/quality/story-quality.js` evaluates 5/10/20 chapter milestones for ghost characters, stale debts $> 5$ chapters, and repetitive cliffhangers.

6. **UI Design System Single Source of Truth (P2)**:
   - `pages/tokens.css` defines the authoritative design tokens for ink, paper, canvas, borders, radius, shadows, and typography.
   - `novels.css`, `skills.css`, `dissect.css` bind all variables directly to `tokens.css` tokens, enabling seamless dark theme transitions.
   - `pages/shell.css` provides standard `.molan-shell`, `.molan-topbar`, `.molan-brand`, and `.molan-nav` layouts.
   - Quality inspection endpoints `POST /api/quality/story-check` and `POST /api/quality/texture-check` are exposed in `services/generation-service.js`.

7. **End-to-End Browser & Integration Verification (P2)**:
   - Headless Edge/Playwright E2E suites (`test/e2e/generation-runtime.spec.js` and `test/e2e/design-system-tokens.spec.js`) verify full offline runtime lifecycles and token reactivity with zero model expenditure.
   - Entire workspace test suite: 1550 passed, 0 failed, 15 skipped.
   - Production import audit (`audit:production-imports`), feature contracts (`audit:features`), and golden suite (`audit:golden`) all 100% green.

### Verified Operational Boundaries
- **Offline / Sandbox Mocking**: All tests run without real model costs using loopback providers or FakeProvider adapters.
- **SQLite / In-Memory JSON Store**: Verified for local storage and native creations; PostgreSQL backup & restore drills validated via dedicated scripts.

