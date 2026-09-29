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
- Before deployment, create a `predeploy` backup and keep it with the release manifest. Generation V2 remains disabled until compatibility, security, blind-review and rollback-target gates pass. Increase `MOLAN_GENERATION_V2_PERCENT` through 1, 10, 50 and 100 only after the current canary meets its regression gates; set `MOLAN_GENERATION_V2=0` or `MOLAN_GENERATION_V2_FORCE_OFF=1` to return traffic to the legacy chain.
- `lib/generation/rollout-policy.js` fails closed when metric evidence is missing or undersampled and trips the runtime kill switch when provider-unknown, commit-conflict, empty-output, billing-failure, state-drift or literary-regression rates cross configured deltas. A deployment controller must distribute the kill switch to every replica; process-local environment mutation alone is not a multi-instance control plane.
