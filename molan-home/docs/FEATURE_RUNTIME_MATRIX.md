# 核心功能与运行时契约矩阵 (FEATURE_RUNTIME_MATRIX)

本矩阵映射前端 UI 交互、后端接口、状态机编排与数据库落地的完整对应关系。

| 功能标识 (Feature ID) | 前端触发 (UI Entrypoint) | 后端路由 (API Endpoint) | 核心执行代码 (Runtime Code) | 持久化实体 (Store) | 自动化测试用例 (Test) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `AI_GENERATE` | `completion-editor.js` (`data-action="ai-generate"`) | `POST /api/generation-runs` | `lib/generation/orchestrator.js` -> `content-engine.js` | `generation_runs` | `test/generation-runs-client.test.js` |
| `AI_STOP` | `completion-editor.js` (`data-action="ai-stop"`) | `POST /api/generation-runs/:id/cancel` | `lib/generation/orchestrator.js: cancel` | `generation_runs.cancel_requested` | `test/generation-runs-client.test.js` |
| `AI_AUDIT` | `completion-editor.js` (`data-action="ai-audit"`) | `POST /api/generation-runs` | `lib/generation/semantic-audit.js` | `generation_runs.audit_result` | `test/semantic-audit-authenticity.test.js` |
| `AI_COMMIT` | `completion-editor.js` (`data-action="ai-commit"`) | `POST /api/generation-runs/:id/commit` | `lib/generation/commit-projection.js` | `novels`, `scenes` | `test/generation-runs-client.test.js` |
| `WAL_LOCAL_PERSIST` | `completion-editor.js` (`scheduleEditorWalSave`) | 纯本地 (IndexDB / LocalStorage) | `lib/client/local-wal.js` | `local_wal_records` | `test/editor-wal.test.js` |
| `CLOUD_PATCH_SAVE` | `completion-editor.js` (`persistNovelScenePatch`) | `PATCH /api/novels/:id/scenes/:sid` | `server.js: handleNovelScenePatch` | `scenes.content`, `novel_revisions` | `test/editor-wal.test.js` |
| `GENRE_CATALOG` | `completion-editor.js` (`loadGenreCatalog`) | `GET /api/genre-catalog` | `lib/genre/genre-registry.js` | 静态注册表 | `test/genre-model-registry.test.js` |
| `MODEL_CAPABILITIES`| `completion-editor.js` (`loadModelCapabilities`) | `GET /api/model-capabilities` | `lib/model/model-registry.js` | 静态注册表 | `test/genre-model-registry.test.js` |
| `STYLE_CATALOG` | `completion-editor.js` (`loadStyleCatalog`) | `GET /api/style-catalog` | `lib/style/style-registry.js` | 静态注册表 | `test/genre-model-registry.test.js` |
| `CAUSAL_DEBT` | `completion-editor.js` (`data-action="causal-debt"`) | `GET /api/causal-debts/:bookId` | `lib/causal-debt-tracker.js` | `causal_debts` | `test/causal-debt.test.js` |

所有功能必须满足：前端有动作绑定、后端有确定路由、执行态有状态转移、持久层有事务落盘。
