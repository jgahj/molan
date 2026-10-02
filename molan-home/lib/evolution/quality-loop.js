'use strict';

const crypto = require('node:crypto');
const { ARTIFACT_NAMES, buildReplayManifest, verifyReplayManifest, canonicalJson, hashJson } = require('./replay-manifest');
const { analyzeQualityRootCauses } = require('../quality/root-cause');
const { runShadowEvaluation } = require('./shadow-evaluator');
const { evaluateRegressionGate, DEFAULT_POLICY: REGRESSION_POLICY } = require('./regression-gate');
const { evaluateExperimentAcceptance, POLICY: EXPERIMENT_POLICY, GUARD_METRICS, OBSERVATION_METRICS } = require('./experiment-acceptance');

const QUALITY_LOOP_SCHEMA = 'quality-loop-run-v1';
const REGRESSION_CATEGORIES = REGRESSION_POLICY.categories;

function requiredString(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new TypeError(`${field} 必填`);
  return normalized;
}

function errorCode(error) {
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(String(error && error.code || ''))
    ? String(error.code)
    : 'QUALITY_LOOP_FAILED';
}

function cloneFrozenJson(value) {
  const copy = JSON.parse(canonicalJson(value));
  const freeze = item => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return item;
    Object.values(item).forEach(freeze);
    return Object.freeze(item);
  };
  return freeze(copy);
}

function taskIdOf(task) {
  return String(task && (task.task_id || task.taskId) || '').trim();
}

function safeHash(value) {
  try { return hashJson(value); } catch (_) { return ''; }
}

function taskDescriptor(task) {
  const artifacts = task && task.artifacts && typeof task.artifacts === 'object' ? task.artifacts : {};
  return {
    task_id: taskIdOf(task),
    genre: String(task && task.genre || ''),
    source_generation_id: String(task && (task.sourceGenerationId || task.source_generation_id) || ''),
    artifact_refs: Object.fromEntries(ARTIFACT_NAMES.map(name => [name, String(artifacts[name] && (artifacts[name].ref || artifacts[name].artifactRef) || '')])),
    artifact_hashes: Object.fromEntries(ARTIFACT_NAMES.map(name => [name, safeHash(artifacts[name] && artifacts[name].snapshot)])),
    model: String(task && task.model || ''),
    model_params_hash: safeHash(task && (task.modelParams || task.parameters)),
    pipeline_version: String(task && task.pipelineVersion || ''),
    prompt_version: String(task && task.promptVersion || ''),
    genre_profile_version: String(task && task.genreProfileVersion || ''),
    style_version: String(task && task.styleVersion || ''),
    benchmark_id: String(task && task.benchmarkId || '')
  };
}

function buildTaskPlan(task) {
  const id = requiredString(taskIdOf(task), 'task.task_id');
  const genre = requiredString(task.genre, `${id}.genre`);
  const sourceGenerationId = requiredString(task.sourceGenerationId || task.source_generation_id, `${id}.sourceGenerationId`);
  const model = requiredString(task.model, `${id}.model`);
  const pipelineVersion = requiredString(task.pipelineVersion, `${id}.pipelineVersion`);
  const promptVersion = requiredString(task.promptVersion, `${id}.promptVersion`);
  const genreProfileVersion = requiredString(task.genreProfileVersion, `${id}.genreProfileVersion`);
  const styleVersion = requiredString(task.styleVersion, `${id}.styleVersion`);
  const benchmarkId = requiredString(task.benchmarkId, `${id}.benchmarkId`);
  const artifacts = task.artifacts;
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) throw new TypeError(`${id}.artifacts 必须是固定快照对象`);
  for (const name of ARTIFACT_NAMES) {
    if (!artifacts[name] || !Object.hasOwn(artifacts[name], 'snapshot')) throw new TypeError(`${id}.artifacts.${name} 必须包含 snapshot`);
  }
  const parameters = task.modelParams || task.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new TypeError(`${id}.modelParams 必须是对象`);
  const replayManifest = task.replayManifest || buildReplayManifest({
    sourceGenerationId, pipelineVersion, promptVersion, genreProfileVersion, styleVersion, model,
    parameters, artifacts
  });
  const replayCheck = verifyReplayManifest(replayManifest, artifacts);
  if (!replayCheck.valid) throw Object.assign(new Error(`${id} 的 Replay Manifest 与快照不匹配`), { code: 'REPLAY_MANIFEST_MISMATCH' });
  if (replayManifest.model !== model || hashJson(replayManifest.parameters) !== hashJson(parameters)) {
    throw Object.assign(new Error(`${id} 的模型或参数与 Replay Manifest 不匹配`), { code: 'REPLAY_CONTROL_MISMATCH' });
  }
  const fixedInputs = {
    genre,
    bibleHash: replayManifest.artifact_hashes.bible,
    outlineHash: replayManifest.artifact_hashes.outline,
    sceneHash: hashJson(artifacts.chapterContract.snapshot.scenes || []),
    contractHash: replayManifest.contractHash,
    contextHash: replayManifest.contextHash,
    model,
    parametersHash: hashJson(parameters),
    benchmarkId
  };
  return {
    id, genre, benchmarkId, artifacts: cloneFrozenJson(artifacts), replayManifest: cloneFrozenJson(replayManifest),
    fixedInputs: Object.freeze(fixedInputs),
    contextSnapshot: cloneFrozenJson(artifacts.contextSnapshot.snapshot)
  };
}

function validateCorpus(manifest, tasks, minimumPairs) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      !Number.isInteger(manifest.taskCount) || manifest.taskCount < 1 ||
      !Array.isArray(manifest.genres) || !manifest.genres.length ||
      !Number.isInteger(manifest.tasksPerGenre) || manifest.tasksPerGenre < 1) {
    return { reason: 'golden_manifest_invalid' };
  }
  if (manifest.fixtureStatus === 'metadata_only') return { reason: 'golden_corpus_metadata_only' };
  if (!['ready', 'test_fixture'].includes(String(manifest.fixtureStatus || ''))) {
    return { reason: 'golden_corpus_status_unavailable' };
  }
  if (!Array.isArray(tasks)) return { reason: 'golden_task_records_missing' };
  if (tasks.length < minimumPairs) return { reason: 'insufficient_golden_tasks', actual: tasks.length, required: minimumPairs };
  if (tasks.length !== manifest.taskCount) return { reason: 'golden_task_count_mismatch', actual: tasks.length, required: manifest.taskCount };
  const ids = new Set();
  const counts = new Map(manifest.genres.map(genre => [String(genre), 0]));
  for (const task of tasks) {
    const id = taskIdOf(task);
    const genre = String(task && task.genre || '');
    if (!id || ids.has(id)) return { reason: id ? 'duplicate_golden_task_id' : 'golden_task_id_missing', task_id: id || null };
    if (!counts.has(genre)) return { reason: 'golden_task_genre_invalid', task_id: id };
    ids.add(id);
    counts.set(genre, counts.get(genre) + 1);
  }
  const incorrectGenre = [...counts.entries()].find(([, count]) => count !== manifest.tasksPerGenre);
  if (incorrectGenre) return { reason: 'golden_genre_count_mismatch', genre: incorrectGenre[0], actual: incorrectGenre[1], required: manifest.tasksPerGenre };
  return null;
}

function sortedRefs(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))].sort();
}

function sanitizeMetrics(metrics, targetMetric) {
  const allowed = new Set([targetMetric, ...GUARD_METRICS, ...OBSERVATION_METRICS]);
  return Object.fromEntries(Object.entries(metrics && typeof metrics === 'object' ? metrics : {})
    .filter(([key, value]) => allowed.has(key) && typeof value === 'number' && Number.isFinite(value)));
}

function validateArmResult(result, request, targetMetric) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError('runner.runArm 必须返回对象');
  const echoedHash = String(result.replayManifestHash || result.replay_manifest_hash || '');
  if (echoedHash !== request.replayManifestHash) {
    throw Object.assign(new Error('runner 输出未绑定原 Replay Manifest'), { code: 'RUN_REPLAY_MANIFEST_MISMATCH' });
  }
  const evidence = sortedRefs(result.evidence_refs || result.evidenceRefs);
  const outputHash = String(result.output_hash || result.outputHash || '') || (typeof result.text === 'string' && result.text ? hashJson(result.text) : '');
  if (!outputHash) throw Object.assign(new Error('runner 输出缺少正文哈希'), { code: 'RUN_OUTPUT_HASH_MISSING' });
  const blocker = result.blocker_check || result.blockerCheck || {};
  const categoryResults = result.category_results || result.categoryResults || {};
  const metricEvidence = result.metric_evidence_refs || result.metricEvidenceRefs || {};
  return {
    generation_id: String(result.generation_id || result.generationId || request.runId),
    output_hash: outputHash,
    replay_manifest_hash: echoedHash,
    metrics: sanitizeMetrics(result.metrics, targetMetric),
    evidence_refs: evidence,
    metric_evidence_refs: Object.fromEntries(Object.entries(metricEvidence).map(([key, refs]) => [key, sortedRefs(refs)])),
    blocker_check: {
      status: String(blocker.status || '').toUpperCase(),
      evidence_ref: String(blocker.evidence_ref || blocker.evidenceRef || '').trim()
    },
    category_results: categoryResults && typeof categoryResults === 'object' ? categoryResults : {},
    defects: Array.isArray(result.defects) ? result.defects : [],
    _text: typeof result.text === 'string' ? result.text : ''
  };
}

function mean(values) {
  if (!values.length || values.some(value => typeof value !== 'number' || !Number.isFinite(value))) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function buildRegressionInputs(pairs, categoryResults, targetMetric, targetDirection) {
  const metrics = [...new Set([targetMetric, ...GUARD_METRICS])];
  const metricValues = {};
  for (const metric of metrics) {
    const baseline = mean(pairs.map(pair => pair.control.metrics[metric]));
    const candidate = mean(pairs.map(pair => pair.treatment.metrics[metric]));
    const refs = sortedRefs(pairs.flatMap(pair => [
      ...(pair.control.metric_evidence_refs[metric] || pair.control.evidence_refs),
      ...(pair.treatment.metric_evidence_refs[metric] || pair.treatment.evidence_refs)
    ]));
    metricValues[metric] = { baseline, candidate, evidence_refs: refs };
  }
  return {
    categoryResults,
    metricValues,
    targetMetric: {
      name: targetMetric,
      direction: targetDirection,
      baseline: mean(pairs.map(pair => pair.control.metrics[targetMetric])),
      candidate: mean(pairs.map(pair => pair.treatment.metrics[targetMetric])),
      evidence_refs: sortedRefs(pairs.flatMap(pair => [
        ...(pair.control.metric_evidence_refs[targetMetric] || pair.control.evidence_refs),
        ...(pair.treatment.metric_evidence_refs[targetMetric] || pair.treatment.evidence_refs)
      ]))
    }
  };
}

function aggregateCategories(armResults) {
  return Object.fromEntries(REGRESSION_CATEGORIES.map(category => {
    const entries = armResults.map(result => result.category_results && result.category_results[category]);
    const statuses = entries.map(entry => String(entry && entry.status || '').toUpperCase());
    const status = statuses.includes('FAIL') ? 'FAIL'
      : statuses.every(value => value === 'PASS') ? 'PASS' : 'BLOCKED';
    return [category, {
      status,
      evidence_refs: status === 'BLOCKED' ? [] : sortedRefs(entries.flatMap(entry => entry && (entry.evidence_refs || entry.evidenceRefs) || []))
    }];
  }));
}

function reportStatus(experiment, regression, shadows) {
  if (experiment.status === 'REJECT' || regression.status === 'REJECT') return 'REJECTED';
  if (experiment.status !== 'PROMOTE' || regression.status !== 'PASS' || shadows.some(item => item.status !== 'completed')) return 'BLOCKED';
  return 'ACCEPTED';
}

function publicReport(base) {
  return JSON.parse(canonicalJson(base));
}

/** Run a fixed-input paired quality experiment without exposing shadow text or mutating user state. */
async function runQualityLoop(input = {}) {
  const store = input.store;
  if (!store || typeof store.beginRun !== 'function' || typeof store.settleRun !== 'function') {
    throw new TypeError('quality loop 需要 beginRun/settleRun 持久化适配器');
  }
  const idempotencyKey = requiredString(input.idempotencyKey, 'idempotencyKey');
  const runId = requiredString(input.runId || crypto.randomUUID(), 'runId');
  const manifest = input.goldenManifest;
  const tasks = input.tasks;
  const baseline = input.baseline || {};
  const candidate = input.candidate || {};
  const targetMetric = requiredString(input.targetMetric, 'targetMetric');
  const targetDirection = input.targetDirection || 'higher';
  const experimentPolicy = input.experimentPolicy || EXPERIMENT_POLICY;
  const regressionPolicy = input.regressionPolicy || REGRESSION_POLICY;
  const descriptors = Array.isArray(tasks) ? tasks.map(taskDescriptor) : null;
  const inputHash = hashJson({
    schema: QUALITY_LOOP_SCHEMA,
    goldenManifest: manifest,
    taskDescriptors: descriptors,
    baseline: { pipelineVersion: baseline.pipelineVersion, promptVersion: baseline.promptVersion },
    candidate: { pipelineVersion: candidate.pipelineVersion, promptVersion: candidate.promptVersion, shadowPromptHash: safeHash(candidate.shadowPrompt) },
    targetMetric, targetDirection, experimentPolicy, regressionPolicy
  });
  const startedAt = Date.now();
  const begun = await store.beginRun({ runId, idempotencyKey, inputHash, createdAt: startedAt });
  if (!begun || !begun.run) throw new TypeError('store.beginRun 必须返回 run');
  if (begun.run.state === 'settled') return { ...begun.run.report, idempotent: true };
  if (!begun.created) {
    return {
      schemaVersion: QUALITY_LOOP_SCHEMA, run_id: begun.run.runId || runId, status: 'RUNNING',
      accepted: false, idempotent: true, reason: 'quality_loop_idempotency_key_in_progress'
    };
  }

  const settle = async report => {
    const result = await store.settleRun({ runId, inputHash, report: publicReport({ ...report, run_id: runId }), settledAt: Date.now() });
    return { ...result.report, idempotent: Boolean(result.idempotent) };
  };
  const blocked = (reason, details = {}) => ({
    schemaVersion: QUALITY_LOOP_SCHEMA,
    status: 'BLOCKED', decision_status: 'BLOCKED', accepted: false,
    reason, ...details, started_at: startedAt, finished_at: Date.now()
  });

  let stage = 'validation';
  try {
    if (!manifest || manifest.fixtureStatus === 'metadata_only') {
      return await settle(blocked('golden_corpus_metadata_only', { corpus_status: 'metadata_only', required_pair_count: experimentPolicy.minimumPairedTasks }));
    }
    const corpusError = validateCorpus(manifest, tasks, experimentPolicy.minimumPairedTasks);
    if (corpusError) return await settle(blocked(corpusError.reason, {
      corpus_status: String(manifest && manifest.fixtureStatus || 'unavailable'),
      required_pair_count: experimentPolicy.minimumPairedTasks,
      actual_task_count: Array.isArray(tasks) ? tasks.length : 0,
      corpus_error: corpusError
    }));
    if (!['higher', 'lower'].includes(targetDirection)) return await settle(blocked('target_direction_invalid'));
    const baselineVersion = {
      pipelineVersion: requiredString(baseline.pipelineVersion, 'baseline.pipelineVersion'),
      promptVersion: requiredString(baseline.promptVersion, 'baseline.promptVersion')
    };
    const candidateVersion = {
      pipelineVersion: requiredString(candidate.pipelineVersion, 'candidate.pipelineVersion'),
      promptVersion: requiredString(candidate.promptVersion, 'candidate.promptVersion')
    };
    requiredString(candidate.shadowPrompt, 'candidate.shadowPrompt');
    const runner = input.runner;
    if (!runner || typeof runner.runArm !== 'function' || typeof runner.generateShadow !== 'function' || typeof runner.evaluateShadow !== 'function') {
      return await settle(blocked('quality_loop_runner_incomplete'));
    }

    const plans = tasks.map(buildTaskPlan);
    const replayBundleHash = hashJson(plans.map(plan => ({ task_id: plan.id, manifest_hash: plan.replayManifest.manifestHash })));
    const baselineRuns = [];
    stage = 'baseline';
    for (const plan of plans) {
      const armRequest = {
        runId: `${runId}:${plan.id}:baseline`, idempotencyKey: `${idempotencyKey}:${plan.id}:baseline`,
        taskId: plan.id, genre: plan.genre, arm: 'baseline', mode: 'experiment',
        version: baselineVersion, replayManifest: plan.replayManifest, replayManifestHash: plan.replayManifest.manifestHash,
        artifacts: plan.artifacts, fixedInputs: plan.fixedInputs
      };
      const result = validateArmResult(await runner.runArm(cloneFrozenJson(armRequest)), armRequest, targetMetric);
      baselineRuns.push({ plan, result });
    }

    stage = 'root_cause';
    const defects = baselineRuns.flatMap(({ plan, result }) => result.defects.map((defect, index) => ({
      ...defect,
      defect_id: `${plan.id}:${String(defect && defect.defect_id || `defect-${index + 1}`)}`
    })));
    const rootCauseReport = analyzeQualityRootCauses({ defects });
    if (rootCauseReport.unresolved_defects.length) {
      return await settle(blocked('root_cause_evidence_incomplete', {
        corpus_status: manifest.fixtureStatus, replay_bundle_hash: replayBundleHash,
        root_cause: rootCauseReport, stage
      }));
    }
    const rootCausesByTask = new Map(plans.map(plan => [plan.id,
      rootCauseReport.rootCauses.filter(cause => String(cause.defect_id || '').startsWith(`${plan.id}:`))
    ]));

    const pairs = [];
    const treatmentRuns = [];
    stage = 'candidate';
    for (const { plan } of baselineRuns) {
      const armRequest = {
        runId: `${runId}:${plan.id}:candidate`, idempotencyKey: `${idempotencyKey}:${plan.id}:candidate`,
        taskId: plan.id, genre: plan.genre, arm: 'candidate', mode: 'experiment',
        version: candidateVersion, replayManifest: plan.replayManifest, replayManifestHash: plan.replayManifest.manifestHash,
        artifacts: plan.artifacts, fixedInputs: plan.fixedInputs, rootCauses: rootCausesByTask.get(plan.id) || []
      };
      const result = validateArmResult(await runner.runArm(cloneFrozenJson(armRequest)), armRequest, targetMetric);
      treatmentRuns.push({ plan, result });
      const baselineRun = baselineRuns.find(item => item.plan.id === plan.id).result;
      pairs.push({
        task_id: plan.id,
        control: { fixed_inputs: plan.fixedInputs, metrics: baselineRun.metrics, evidence_refs: baselineRun.evidence_refs, metric_evidence_refs: baselineRun.metric_evidence_refs },
        treatment: { fixed_inputs: plan.fixedInputs, metrics: result.metrics, evidence_refs: result.evidence_refs, metric_evidence_refs: result.metric_evidence_refs },
        blocker_check: result.blocker_check
      });
    }

    stage = 'shadow';
    const shadows = [];
    for (const { plan, result } of treatmentRuns) {
      const shadow = await runShadowEvaluation({
        generationId: result.generation_id,
        contextSnapshot: plan.contextSnapshot,
        shadowPrompt: candidate.shadowPrompt,
        promptVersion: candidateVersion.promptVersion,
        model: plan.replayManifest.model,
        parameters: plan.replayManifest.parameters,
        generateShadow: async request => {
          const generated = await runner.generateShadow(cloneFrozenJson({
            ...request, taskId: plan.id, runId: `${runId}:${plan.id}:shadow`,
            idempotencyKey: `${idempotencyKey}:${plan.id}:shadow`,
            replayManifest: plan.replayManifest, replayManifestHash: plan.replayManifest.manifestHash,
            version: candidateVersion
          }));
          if (String(generated && (generated.replayManifestHash || generated.replay_manifest_hash) || '') !== plan.replayManifest.manifestHash) {
            throw Object.assign(new Error('shadow 输出未绑定原 Replay Manifest'), { code: 'RUN_REPLAY_MANIFEST_MISMATCH' });
          }
          return generated;
        },
        evaluateShadow: async request => {
          const evaluated = await runner.evaluateShadow(cloneFrozenJson({
            ...request, taskId: plan.id, replayManifest: plan.replayManifest,
            replayManifestHash: plan.replayManifest.manifestHash, version: candidateVersion
          }));
          return evaluated;
        }
      });
      shadows.push({ task_id: plan.id, replay_manifest_hash: plan.replayManifest.manifestHash, ...shadow });
    }
    if (shadows.some(item => item.status !== 'completed' || item.user_visible !== false ||
        item.user_billing_mutation !== 'none' || item.state_mutation !== 'none' || !item.evidence_refs.length)) {
      return await settle(blocked('shadow_evidence_incomplete', {
        corpus_status: manifest.fixtureStatus, replay_bundle_hash: replayBundleHash,
        root_cause: rootCauseReport, shadow_runs: shadows.map(({ task_id, replay_manifest_hash, status, error_code, metrics, evidence_refs, user_visible, user_billing_mutation, state_mutation }) => ({
          task_id, replay_manifest_hash, status, error_code: error_code || null, metrics, evidence_refs,
          user_visible, user_billing_mutation, state_mutation
        })), stage
      }));
    }

    stage = 'regression';
    const experiment = evaluateExperimentAcceptance({ pairs, targetMetric, targetDirection, policy: experimentPolicy });
    const regressionInputs = buildRegressionInputs(pairs, aggregateCategories(treatmentRuns.map(item => item.result)), targetMetric, targetDirection);
    const regression = evaluateRegressionGate({ ...regressionInputs, policy: regressionPolicy });
    const decision = reportStatus(experiment, regression, shadows);
    const testOnly = manifest.fixtureStatus === 'test_fixture';
    const report = {
      schemaVersion: QUALITY_LOOP_SCHEMA,
      status: testOnly ? 'TEST_ONLY' : decision,
      decision_status: decision,
      accepted: !testOnly && decision === 'ACCEPTED',
      promotion_eligible: !testOnly && decision === 'ACCEPTED',
      corpus_status: manifest.fixtureStatus,
      corpus_task_count: tasks.length,
      paired_task_count: experiment.pair_count,
      required_pair_count: experiment.required_pair_count,
      golden_manifest_hash: hashJson(manifest),
      replay_bundle_hash: replayBundleHash,
      replay_manifest_hashes: Object.fromEntries(plans.map(plan => [plan.id, plan.replayManifest.manifestHash])),
      baseline: baselineVersion,
      candidate: candidateVersion,
      target_metric: targetMetric,
      target_direction: targetDirection,
      root_cause: rootCauseReport,
      experiment_acceptance: experiment,
      regression_gate: regression,
      shadow_runs: shadows.map(({ task_id, replay_manifest_hash, status, error_code, metrics, evidence_refs, user_visible, user_billing_mutation, state_mutation }) => ({
        task_id, replay_manifest_hash, status, error_code: error_code || null, metrics, evidence_refs,
        user_visible, user_billing_mutation, state_mutation
      })),
      started_at: startedAt,
      finished_at: Date.now()
    };
    return await settle(report);
  } catch (error) {
    return await settle(blocked('quality_loop_stage_failed', { stage, error_code: errorCode(error) }));
  }
}

function rowToRun(row) {
  if (!row) return null;
  let report = null;
  try { report = JSON.parse(String(row.report_json || 'null')); } catch (_) {}
  return {
    runId: String(row.run_id), idempotencyKey: String(row.idempotency_key), inputHash: String(row.input_hash),
    state: String(row.state), report, reportHash: row.report_hash == null ? null : String(row.report_hash),
    createdAt: Number(row.created_at) || 0, settledAt: row.settled_at == null ? null : Number(row.settled_at)
  };
}

function inImmediateTransaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/** SQLite-backed idempotency and immutable settlement adapter; the caller owns the connection. */
function createSqliteQualityLoopStore(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') {
    throw new TypeError('Quality loop store 需要有效的数据库连接 (支持 exec 和 prepare)');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS quality_loop_runs (
      run_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      input_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('running', 'settled')),
      report_json TEXT NOT NULL DEFAULT 'null',
      report_hash TEXT,
      created_at INTEGER NOT NULL,
      settled_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_quality_loop_runs_settled ON quality_loop_runs(state, created_at DESC);
  `);

  function beginRun(input) {
    const runId = requiredString(input && input.runId, 'runId');
    const idempotencyKey = requiredString(input && input.idempotencyKey, 'idempotencyKey');
    const inputHash = requiredString(input && input.inputHash, 'inputHash');
    return inImmediateTransaction(db, () => {
      const existing = db.prepare('SELECT * FROM quality_loop_runs WHERE idempotency_key = ?').get(idempotencyKey);
      if (existing) {
        if (String(existing.input_hash) !== inputHash) {
          throw Object.assign(new Error('幂等键已绑定其他评测输入'), { code: 'QUALITY_LOOP_IDEMPOTENCY_CONFLICT' });
        }
        return { run: rowToRun(existing), created: false };
      }
      db.prepare(`INSERT INTO quality_loop_runs(run_id,idempotency_key,input_hash,state,report_json,created_at)
        VALUES(?,?,?,'running','null',?)`)
        .run(runId, idempotencyKey, inputHash, Number(input.createdAt) || Date.now());
      const inserted = db.prepare('SELECT * FROM quality_loop_runs WHERE run_id = ?').get(runId);
      return { run: rowToRun(inserted), created: true };
    });
  }

  function settleRun(input) {
    const runId = requiredString(input && input.runId, 'runId');
    const inputHash = requiredString(input && input.inputHash, 'inputHash');
    const reportJson = canonicalJson(input.report);
    const reportHash = hashJson(input.report);
    return inImmediateTransaction(db, () => {
      const existing = db.prepare('SELECT * FROM quality_loop_runs WHERE run_id = ?').get(runId);
      if (!existing) throw Object.assign(new Error('quality loop run 不存在'), { code: 'QUALITY_LOOP_RUN_NOT_FOUND' });
      if (String(existing.input_hash) !== inputHash) {
        throw Object.assign(new Error('quality loop run 输入摘要不匹配'), { code: 'QUALITY_LOOP_INPUT_MISMATCH' });
      }
      if (existing.state === 'settled') {
        if (String(existing.report_hash || '') === reportHash) return { run: rowToRun(existing), report: rowToRun(existing).report, idempotent: true };
        throw Object.assign(new Error('已结算的 quality loop 记录不可覆盖'), { code: 'QUALITY_LOOP_SETTLED_IMMUTABLE' });
      }
      const update = db.prepare(`UPDATE quality_loop_runs
        SET state='settled', report_json=?, report_hash=?, settled_at=?
        WHERE run_id=? AND input_hash=? AND state='running'`)
        .run(reportJson, reportHash, Number(input.settledAt) || Date.now(), runId, inputHash);
      if (Number(update.changes) !== 1) throw Object.assign(new Error('quality loop 结算竞争失败'), { code: 'QUALITY_LOOP_SETTLEMENT_CONFLICT' });
      const settled = rowToRun(db.prepare('SELECT * FROM quality_loop_runs WHERE run_id = ?').get(runId));
      return { run: settled, report: settled.report, idempotent: false };
    });
  }

  function getByIdempotencyKey(key) {
    return rowToRun(db.prepare('SELECT * FROM quality_loop_runs WHERE idempotency_key = ?').get(String(key || '')));
  }

  return { beginRun, settleRun, getByIdempotencyKey };
}

const { createGenerationArtifact, executeClosedEvolutionLoop } = require('./benchmark-evolution-loop');

module.exports = {
  QUALITY_LOOP_SCHEMA,
  runQualityLoop,
  createSqliteQualityLoopStore,
  validateCorpus,
  buildTaskPlan,
  createGenerationArtifact,
  executeClosedEvolutionLoop
};
