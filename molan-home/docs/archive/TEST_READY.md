# TEST_READY: 4-Tier E2E Test Suite for Molan Phase 2 Engine Architecture (R1-R4, C1-C5)

- **Author**: `p2_test_writer_1` (`teamwork_preview_test_writer`)
- **Date**: 2026-10-08T01:21:00Z
- **Target File**: `molan-home/test/e2e-phase2-engine.test.js`
- **Runtime**: Node 22 (`tools/node22_runtime/node.exe`)
- **Status**: **READY FOR MILESTONE GATING (M1 - M5)**

---

## 1. Test Execution Commands

Run the complete 4-tier E2E suite via PowerShell from `molan-home`:
```powershell
& "..\tools\node22_runtime\node.exe" --no-warnings --test test/e2e-phase2-engine.test.js
```

Or with detailed spec reporter:
```powershell
& "..\tools\node22_runtime\node.exe" --no-warnings --test --test-reporter=spec test/e2e-phase2-engine.test.js
```

Run specific tiers using name patterns:
```powershell
# Tier 1 (Feature Coverage)
& "..\tools\node22_runtime\node.exe" --no-warnings --test --test-name-pattern="Tier 1" test/e2e-phase2-engine.test.js

# Tier 2 (Boundary & Corner Cases)
& "..\tools\node22_runtime\node.exe" --no-warnings --test --test-name-pattern="Tier 2" test/e2e-phase2-engine.test.js

# Tier 3 (Cross-Feature Interactions)
& "..\tools\node22_runtime\node.exe" --no-warnings --test --test-name-pattern="Tier 3" test/e2e-phase2-engine.test.js

# Tier 4 (Real-World Scenarios)
& "..\tools\node22_runtime\node.exe" --no-warnings --test --test-name-pattern="Tier 4" test/e2e-phase2-engine.test.js
```

---

## 2. Test Suite Architecture & Coverage Matrix

The suite defines **60 opaque-box, deterministic, and isolated test cases** structured across 4 tiers:

| Tier | Sub-Suite | Features Tested | Test Count | Current Pass | Pending Implementation Gating |
|---|---|---|---|---|---|
| **Tier 1: Feature Coverage** | Primary happy paths & interface contracts | R1, R2, R3, R4 | 25 | 6 | 19 (gated by M1, M2, M3, M4) |
| **Tier 2: Boundary & Corner Cases** | Edge values, 0 tokens, N < K, corrupted pointers, checksum tampering | R1, R2, R3, R4 | 25 | 7 | 18 (gated by M1, M2, M3, M4) |
| **Tier 3: Cross-Feature Interactions** | Discovery -> Attention -> Request Wiring, Publisher -> Hot Reload -> Injection | Cross-subsystems | 5 | 2 | 3 (gated by M1, M3, M4) |
| **Tier 4: Real-World Scenarios** | Full pipeline runs, concurrent readers, closed-loop evolution, multi-genre | End-to-end workflows | 5 | 1 | 4 (gated by M1, M3, M4) |
| **Total** | | **Phase 2 Complete Scope** | **60** | **16** | **44** |

---

## 3. Milestone Gating Map for Implementation (M1 - M5)

The 44 failing tests represent authoritative acceptance criteria for each upcoming implementation milestone. As each milestone is implemented by the assigned agent, the corresponding tests will turn green without modifying any test code:

### Milestone M1: Chapter Archetype Discovery (R1 / C1)
- **Target Modules**: `lib/composition/corpus/archetype-discoverer.js`, `batch-pipeline.js`, `scripts/corpus-cli.js`
- **Gated Tests (12 tests)**:
  - `T1.1`: Standalone archetype discovery produces structured `archetypes.json` derived from feature centroids
  - `T1.2`: Synthesized `ChapterArchetype` contains dynamic `structuralDynamics`, `tensionProfile`, and `pacingFormula`
  - `T1.3`: Archetypes include valid `exemplars` sorted by centroid distance and `clusterMembers` references
  - `T1.4`: Batch pipeline `runDiscoverPatterns` decouples from `runBuildStrategy` and preserves `strategy-rules.jsonl`
  - `T1.5`: CLI `corpus-cli.js discover-patterns` delegates to `runDiscoverPatterns`
  - `T2.1`: Small sample dataset $N < K$ clamps $K$ dynamically without empty cluster failure
  - `T2.2`: Single chapter dataset $N = 1$ clusters into 1 archetype with centroid matching vector
  - `T2.3`: Handles missing or partial stylometry features with safe defaults without NaN
  - `T2.4`: Empty corpus run directory (0 chapters) handles gracefully or throws informative error
  - `T2.5`: Extreme feature outliers (all 0s / all 1s) compute distance without division by zero
  - `T3.1`: Archetype Discovery -> Attention Tiering -> Model Request wiring pipeline
  - `T4.1`: Full Corpus-to-Generation Pipeline (Discovery -> Publish -> Hot Reload -> Generation Request)
- **Acceptance Criterion**: All 12 archetype discovery tests pass cleanly.

### Milestone M2: Attention Tiering Hard Budget & Request Wiring (R2 / C2)
- **Target Modules**: `lib/composition/compiler/attention-tiering.js`, `strategy-compiler.js`, `lib/generation/content-engine.js`
- **Gated Tests (7 tests)**:
  - `T1.7`: Multi-stage pruning drops Tier 3 first, then summarizes Tier 1/Tier 4, and compacts Tier 2
  - `T1.8`: `FINAL_BUDGET_ASSERT` invariant strictly asserts `totalTokens <= maxTotalTokens` or throws `BUDGET_EXCEEDED`
  - `T1.9`: `strategy-compiler` binds tiered attention outputs into returned prompts and attention payload
  - `T1.10`: `content-engine` `buildDraftRequest` and `generateDraft` wire attention object into `callModel` payload
  - `T2.6`: Zero token budget `maxTotalTokens = 0` strictly asserts budget and throws `BUDGET_EXCEEDED`
  - `T2.7`: Ultra-tight budget `maxTotalTokens = 15` compacts critical items to satisfy budget
  - `T2.8`: Massive overflow of critical blocks never causes silent budget leak
- **Acceptance Criterion**: All 7 attention hard budget and request wiring tests pass cleanly.

### Milestone M3: Evidence Catalog Hot Reload & Package Publisher Guard (R3 / C3)
- **Target Modules**: `lib/composition/corpus/evidence-catalog.js`, `package-publisher.js`
- **Gated Tests (10 tests)**:
  - `T1.13`: Direct `getCard(id)` lookup triggers hot-reload check eliminating permanent caching bug
  - `T1.15`: `loadActivePublishedPackage` resolves relative `packageDir` relative to `baseDir`
  - `T1.18`: Publisher throws version conflict error when publishing existing version with mismatched checksum
  - `T1.19`: Published package manifests and active pointer store relative POSIX package directory paths
  - `T2.11`: Rapid successive package updates with same second timestamp recognize version changes
  - `T2.16`: Modifying 1 byte in `strategy-rules.jsonl` triggers checksum mismatch on re-publish
  - `T2.18`: Resolves deep nested relative base paths without path separator anomalies
  - `T2.19`: Tampered `package-manifest.json` checksum triggers mismatch on verification
  - `T3.5`: Publisher checksum rejection preserves active pointer and `EvidenceCatalog` serving consistency
  - `T4.4`: Resilient recovery from mismatched publisher tampering followed by idempotent retry
- **Acceptance Criterion**: All 10 hot reload and publisher guard tests pass cleanly.

### Milestone M4: Closed-Loop Experiment Engine (R4 / C4)
- **Target Modules**: `lib/composition/evaluation/experiment-engine.js`, `compatibility-matrix.js`, `evidence-catalog.js`
- **Gated Tests (15 tests)**:
  - `T1.21`: `ExperimentEngine` coordinates A/B evaluation across (Genre × Style × Goal × Focus × Hook)
  - `T1.22`: 4-Axis Multi-Dimensional Scoring computes causal, literary, AI-flavor risk, and tension delta
  - `T1.23`: Differential calculation evaluates signed lifts between Treatment and Control
  - `T1.24`: `StrategyCard` feedback loop updates card stats and recalculates `evidenceStrength`
  - `T1.25`: Empirical compatibility matrix registers observed synergy lift for 5-tuple context
  - `T2.21`: Identical candidate scores $\Delta = 0$ updates confidence stably without NaN
  - `T2.22`: Severe negative lift $\Delta < 0$ triggers evidence strength downgrade
  - `T2.23`: 100% AI-flavor penalty properly lowers overall score without NaN
  - `T2.24`: Missing optional tuple dimensions applies safe fallback defaults
  - `T2.25`: Gracefully handles empty draft candidate with error isolation
  - `T3.2`: Publisher -> Hot Reload -> Attention Evidence selection injection flow
  - `T3.3`: Experiment Engine -> `StrategyCard` feedback -> Hot Reload -> Regeneration cycle
  - `T4.2`: Closed-Loop Strategy Evolution Loop across generations
  - `T4.5`: Multi-Genre experimentation with tension curve and causal verification
- **Acceptance Criterion**: All 14 experiment engine and feedback loop tests pass cleanly.

### Milestone M5: 100% E2E Pass + Full Verification
- **Acceptance Criterion**: Full test execution passes with **60 / 60 tests (100% pass rate)** under Node 22 (`tools/node22_runtime/node.exe`), with zero regressions across all existing suites.

---

## 4. Test Independence & Isolation Guarantees

- **No Shared State**: Every test suite and test case creates its own isolated temp directory using `fs.mkdtempSync(path.join(os.tmpdir(), 'molan_p2_e2e_suite_...'))` and cleans up on completion in `after()` hooks.
- **Zero Touching of Protected Directories**: Protected data directories (`books/`, `raws/`, `deploy_tmp/`, `tmp-booktest/`, `.uploads/`) are never accessed, read, or modified by the test suite.
- **Node Native Tooling**: Pure Node.js `node:test` and `node:assert/strict` with zero external test framework dependencies.
