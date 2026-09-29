'use strict';

const { createHash } = require('node:crypto');
const { buildSoakPlan, evaluateSoakRun, SOAK_MILESTONES, SOAK_CHECKPOINT_METRICS } = require('./soak-test');
const { hashJson } = require('./replay-manifest');

const ACTIVE_TASKS = new Set();

/** 校验持久化引用字段并返回去除首尾空白后的值。 */
function requiredRef(value, field) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw new TypeError(`${field} 必填`);
  return result;
}

/** 计算章节正文的 SHA-256。 */
function contentHash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 校验已保存的长篇任务状态是否仍绑定同一组不可变输入。 */
function normalizeState(state, plan) {
  if (!state) {
    return {
      schemaVersion: 'long-form-soak-state-v1',
      task_id: plan.task_id,
      target_chapters: plan.target_chapters,
      replay_manifest_hash: plan.replay_manifest_hash,
      execution_adapter_hash: plan.execution_adapter_hash,
      chapters: [],
      checkpoints: [],
      pending_chapter: null,
      execution_status: 'running',
      updated_at: Date.now()
    };
  }
  if (state.schemaVersion !== 'long-form-soak-state-v1' || state.task_id !== plan.task_id ||
      state.target_chapters !== plan.target_chapters || state.replay_manifest_hash !== plan.replay_manifest_hash ||
      state.execution_adapter_hash !== plan.execution_adapter_hash ||
      !Array.isArray(state.chapters) || !Array.isArray(state.checkpoints)) {
    throw new TypeError('Soak 持久化状态与 task、milestone 或 Replay Manifest 不一致');
  }
  const seen = new Set();
  for (const chapter of state.chapters) {
    const index = Number(chapter && chapter.chapter_index);
    if (!Number.isInteger(index) || index < 1 || index > plan.target_chapters || seen.has(index)) {
      throw new TypeError('Soak 持久化状态包含无效或重复章节');
    }
    seen.add(index);
    if (chapter.text && contentHash(chapter.text) !== chapter.text_hash) {
      throw new TypeError(`第 ${index} 章正文哈希不匹配`);
    }
  }
  if (state.pending_chapter && state.pending_chapter.text &&
      contentHash(state.pending_chapter.text) !== state.pending_chapter.text_hash) {
    throw new TypeError('Soak 待审正文哈希不匹配');
  }
  return {
    ...state,
    pending_chapter: state.pending_chapter || null,
    execution_status: ['provider_unknown', 'completed', 'audit_failed'].includes(state.execution_status)
      ? state.execution_status
      : 'running'
  };
}

/** 校验每十章健康检查所需的全部非负指标。 */
function validateMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) throw new TypeError('Checkpoint metrics 必须是对象');
  const normalized = {};
  for (const key of SOAK_CHECKPOINT_METRICS) {
    const value = metrics[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`Checkpoint metrics.${key} 必须是非负有限数`);
    }
    normalized[key] = value;
  }
  return normalized;
}

/** 使用持久化 fencing lease 串行执行固定回放输入并支持安全续跑。 */
async function runSoakTask(options = {}) {
  const {
    taskId, replayManifest, milestone = 100, store, generateChapter, auditChapter, executorHash,
    measureCheckpoint, recoverUnknown, signal, onProgress, now = Date.now
  } = options;
  const plan = buildSoakPlan({ taskId, replayManifest, milestone });
  plan.execution_adapter_hash = requiredRef(executorHash || replayManifest.pipelineVersion, 'executorHash');
  const manifestPayload = Object.fromEntries(Object.entries(replayManifest).filter(([key]) => key !== 'manifestHash'));
  if (hashJson(manifestPayload) !== replayManifest.manifestHash) throw new TypeError('Soak Replay Manifest 哈希校验失败');
  if (!store || typeof store.load !== 'function' || typeof store.save !== 'function' || typeof store.withLease !== 'function') {
    throw new TypeError('Soak store 必须实现 load、save 和带 fencing token 的 withLease');
  }
  if (typeof generateChapter !== 'function' || typeof auditChapter !== 'function' ||
      (milestone >= 10 && typeof measureCheckpoint !== 'function')) {
    throw new TypeError('Soak runner 缺少生成、审计或检查点适配器');
  }
  if (ACTIVE_TASKS.has(plan.task_id)) throw new Error('SOAK_ALREADY_RUNNING');
  ACTIVE_TASKS.add(plan.task_id);

  try {
    return await store.withLease(plan.task_id, async lease => {
      const fencingToken = requiredRef(lease && lease.fencingToken, 'lease.fencingToken');
      const runSignal = lease && lease.signal || signal;
      const state = normalizeState(await store.load(plan.task_id), plan);
      const persist = async () => {
        state.updated_at = now();
        await store.save(plan.task_id, state, { fencingToken, leaseOwner: lease && lease.leaseOwner });
      };
      const chapters = new Map(state.chapters.map(chapter => [chapter.chapter_index, chapter]));
      const checkpoints = new Map(state.checkpoints.map(checkpoint => [checkpoint.chapter_index, checkpoint]));

      if (['completed', 'audit_failed'].includes(state.execution_status)) {
        return { ...evaluateSoakRun({ plan, chapters: state.chapters, checkpoints: state.checkpoints }), execution_status: state.execution_status, resume_after_chapter: Math.max(0, ...chapters.keys()) };
      }

      if (state.execution_status === 'provider_unknown') {
        const index = Number(state.unknown_chapter_index);
        if (typeof recoverUnknown !== 'function') {
          return { ...evaluateSoakRun({ plan, chapters: state.chapters, checkpoints: state.checkpoints }), execution_status: 'provider_unknown', resume_after_chapter: index - 1 };
        }
        const recovered = await recoverUnknown({
          taskId: plan.task_id,
          chapterIndex: index,
          idempotencyKey: `${plan.task_id}:chapter:${index}`,
          replayManifest,
          fencingToken,
          signal: runSignal
        });
        if (!recovered || recovered.resolved !== true) {
          return { ...evaluateSoakRun({ plan, chapters: state.chapters, checkpoints: state.checkpoints }), execution_status: 'provider_unknown', resume_after_chapter: index - 1 };
        }
        state.pending_chapter = normalizeGeneratedChapter(recovered.chapter, index);
        if (state.pending_chapter.status !== 'pending_audit') {
          state.chapters.push(state.pending_chapter);
          chapters.set(index, state.pending_chapter);
          state.pending_chapter = null;
          state.execution_status = 'audit_failed';
          await persist();
          return { ...evaluateSoakRun({ plan, chapters: state.chapters, checkpoints: state.checkpoints }), execution_status: state.execution_status, resume_after_chapter: index - 1 };
        }
        delete state.unknown_chapter_index;
        state.execution_status = 'running';
        await persist();
      }

      const finishPendingAudit = async () => {
        if (!state.pending_chapter) return true;
        const pending = state.pending_chapter;
        if (pending.status !== 'pending_audit') {
          state.chapters.push(pending);
          chapters.set(pending.chapter_index, pending);
          state.pending_chapter = null;
          state.execution_status = 'audit_failed';
          await persist();
          return false;
        }
        try {
          const completed = await auditPendingChapter({ taskId: plan.task_id, pending, auditChapter, replayManifest, fencingToken, signal: runSignal });
          state.chapters.push(completed);
          chapters.set(completed.chapter_index, completed);
          state.pending_chapter = null;
          state.execution_status = completed.audit_passed ? 'running' : 'audit_failed';
          await persist();
          return completed.audit_passed;
        } catch (error) {
          state.execution_status = 'interrupted';
          state.last_error_code = String(error && error.code || 'AUDIT_FAILED');
          await persist();
          return false;
        }
      };

      if (!await finishPendingAudit()) {
        return { ...evaluateSoakRun({ plan, chapters: state.chapters, checkpoints: state.checkpoints }), execution_status: state.execution_status, resume_after_chapter: Math.max(0, ...chapters.keys()) };
      }

      for (let chapterIndex = 1; chapterIndex <= milestone; chapterIndex += 1) {
        let chapter = chapters.get(chapterIndex);
        if (chapter && chapter.status !== 'completed') break;
        if (!chapter) {
        if (runSignal && runSignal.aborted) {
            state.execution_status = 'paused';
            await persist();
            break;
          }

          let generated;
          try {
            generated = await generateChapter({
              taskId: plan.task_id,
              chapterIndex,
              idempotencyKey: `${plan.task_id}:chapter:${chapterIndex}`,
              replayManifest,
              previousChapters: state.chapters.filter(item => item.chapter_index < chapterIndex),
              fencingToken,
              signal: runSignal
            });
          } catch (error) {
            state.execution_status = error && ['PROVIDER_UNKNOWN', 'USAGE_UNKNOWN'].includes(error.code) ? 'provider_unknown' : 'interrupted';
            if (state.execution_status === 'provider_unknown') state.unknown_chapter_index = chapterIndex;
            state.last_error_code = state.execution_status === 'provider_unknown' ? error.code : String(error && error.code || 'GENERATION_FAILED');
            await persist();
            break;
          }

          if (generated && ['provider_unknown', 'unknown'].includes(generated.status)) {
            state.execution_status = 'provider_unknown';
            state.unknown_chapter_index = chapterIndex;
            state.last_error_code = 'PROVIDER_UNKNOWN';
            await persist();
            break;
          }

          state.pending_chapter = normalizeGeneratedChapter(generated, chapterIndex);
          await persist();
          if (state.pending_chapter.status === 'pending_audit') {
            if (!await finishPendingAudit()) break;
          } else {
            const failed = state.pending_chapter;
            state.chapters.push(failed);
            chapters.set(chapterIndex, failed);
            state.pending_chapter = null;
            state.execution_status = failed.status === 'failed' ? 'audit_failed' : 'interrupted';
            await persist();
            break;
          }
          chapter = chapters.get(chapterIndex);
          if (typeof onProgress === 'function') await onProgress({ taskId: plan.task_id, chapterIndex, targetChapters: milestone, chapter });
        }
        if (chapter.status !== 'completed' || chapter.audit_passed !== true) {
          state.execution_status = 'audit_failed';
          await persist();
          break;
        }

        if (plan.checkpoints.includes(chapterIndex) && !checkpoints.has(chapterIndex)) {
          const measured = await measureCheckpoint({
            taskId: plan.task_id,
            chapterIndex,
            replayManifest,
            chapters: state.chapters,
            fencingToken,
            signal: runSignal
          });
          const checkpoint = {
            chapter_index: chapterIndex,
            evidence_ref: requiredRef(measured && measured.evidence_ref, `checkpoint_${chapterIndex}.evidence_ref`),
            metrics: validateMetrics(measured && measured.metrics)
          };
          state.checkpoints.push(checkpoint);
          checkpoints.set(chapterIndex, checkpoint);
          await persist();
        }
      }

      if (state.execution_status === 'running') {
        const report = evaluateSoakRun({ plan, chapters: state.chapters, checkpoints: state.checkpoints });
        state.execution_status = report.status === 'PASS' ? 'completed' : report.status === 'FAIL' ? 'audit_failed' : 'paused';
      }
      await persist();
      return {
        ...evaluateSoakRun({ plan, chapters: state.chapters, checkpoints: state.checkpoints }),
        execution_status: state.execution_status,
        resume_after_chapter: Math.max(0, ...chapters.keys())
      };
    }, { manifestHash: plan.replay_manifest_hash, signal });
  } finally {
    ACTIVE_TASKS.delete(plan.task_id);
  }
}

/** 固化 Writer 响应并校验正文哈希与生成证据。 */
function normalizeGeneratedChapter(generated, chapterIndex) {
  const text = typeof generated?.text === 'string' ? generated.text : '';
  if (generated?.status !== 'completed' || !text.trim()) {
    return {
      chapter_index: chapterIndex,
      text_hash: text ? contentHash(text) : '',
      evidence_ref: String(generated && generated.evidence_ref || ''),
      status: generated?.status === 'failed' ? 'failed' : 'blocked',
      audit_passed: false,
      text
    };
  }
  const textHash = contentHash(text);
  const outputHashMatches = !generated.output_hash || generated.output_hash === textHash;
  const runEvidenceRef = typeof generated.evidence_ref === 'string' ? generated.evidence_ref.trim() : '';
  if (!outputHashMatches || !runEvidenceRef) {
    return {
      chapter_index: chapterIndex,
      text_hash: textHash,
      evidence_ref: runEvidenceRef,
      status: outputHashMatches ? 'blocked' : 'failed',
      audit_passed: false,
      error_code: outputHashMatches ? 'MISSING_GENERATION_EVIDENCE' : 'OUTPUT_HASH_MISMATCH',
      text
    };
  }
  return {
    chapter_index: chapterIndex,
    text_hash: textHash,
    evidence_ref: runEvidenceRef,
    status: 'pending_audit',
    audit_passed: false,
    text
  };
}

/** 对已持久化正文执行审计并生成章节结果记录。 */
async function auditPendingChapter({ taskId, pending, auditChapter, replayManifest, fencingToken, signal }) {
  const audit = await auditChapter({
    taskId,
    chapterIndex: pending.chapter_index,
    text: pending.text,
    textHash: pending.text_hash,
    evidenceRef: pending.evidence_ref,
    replayManifest,
    fencingToken,
    signal
  });
  return {
    chapter_index: pending.chapter_index,
    text_hash: pending.text_hash,
    evidence_ref: requiredRef(audit && audit.evidence_ref, `chapter_${pending.chapter_index}.audit_evidence_ref`),
    status: audit && audit.status === 'failed' ? 'failed' : 'completed',
    audit_passed: audit && audit.passed === true,
    text: pending.text
  };
}

module.exports = { runSoakTask, contentHash, SOAK_MILESTONES };
