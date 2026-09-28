import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RESOURCE_ROOT = path.resolve(import.meta.dirname, '..', '..', '资源库');
const DEFAULT_INTERMEDIATE = path.join(RESOURCE_ROOT, 'intermediate');
const DEFAULT_OUTPUT = path.join(RESOURCE_ROOT, 'classification-review.json');
const DEFAULT_BASE_URL = `http://127.0.0.1:${process.env.PORT || 3000}`;
const MAX_BATCH_SIZE = 20;
const MIN_DELAY_MS = 2000;
const REVIEW_PROMPT_VERSION = 'character-candidate-review-v3';

/** 从候选行提取模型复核必须绑定的完整哈希，避免复核结果脱离原始文本复用。
 * 参数：row 为待复核候选行。
 * 返回值：候选、章节、原书和规范化原书文本的哈希绑定对象。
 */
function candidateInputBinding(row) {
  const provenance = row?.provenance && typeof row.provenance === 'object' ? row.provenance : {};
  return {
    candidateTextHash: String(provenance.candidateTextHash || '').trim().toLowerCase(),
    candidateTextSha256: String(provenance.candidateTextSha256 || '').trim().toLowerCase(),
    chapterTextHash: String(provenance.chapterTextHash || '').trim().toLowerCase(),
    chapterTextSha256: String(provenance.chapterTextSha256 || '').trim().toLowerCase(),
    sourceContentHash: String(provenance.sourceContentHash || '').trim().toLowerCase(),
    sourceTextHash: String(provenance.sourceTextHash || '').trim().toLowerCase()
  };
}

/** 判断复核结果是否带有当前版本所需的完整输入绑定。
 * 参数：value 为复核结果中的 inputBinding 对象。
 * 返回值：所有绑定字段均为完整 SHA-256 或稳定短哈希时返回 true。
 */
function hasCompleteInputBinding(value) {
  const binding = value && typeof value === 'object' ? value : {};
  return /^[a-f0-9]{64}$/iu.test(String(binding.candidateTextSha256 || '').trim())
    && /^[a-f0-9]{64}$/iu.test(String(binding.chapterTextSha256 || '').trim())
    && /^[a-f0-9]{64}$/iu.test(String(binding.sourceContentHash || '').trim())
    && /^[a-f0-9]{64}$/iu.test(String(binding.sourceTextHash || '').trim())
    && /^[a-f0-9]{16}$/iu.test(String(binding.candidateTextHash || '').trim())
    && /^[a-f0-9]{16}$/iu.test(String(binding.chapterTextHash || '').trim());
}

/** 为待复核候选提取稳定的人物实体分组键，优先使用已有角色键和候选人名线索。
 * 参数：item 为待复核候选。
 * 返回值：用于分组的实体键；没有线索时按候选 ID 隔离。
 */
function candidateReviewEntityKey(item) {
  const explicit = String(item?.characterEvidence?.characterKey || item?.characterKey || '').trim();
  if (explicit) return `key:${explicit}`;
  const names = Array.isArray(item?.characterEvidence?.candidateNames)
    ? item.characterEvidence.candidateNames.map(value => String(value || '').trim()).filter(Boolean).sort()
    : [];
  return names.length ? `names:${names.join('|')}` : `entity:unresolved:${String(item?.candidateId || '').trim()}`;
}

/** 生成“作品×人物实体×性格×维度”的稳定复核分组键。
 * 参数：item 为待复核候选。
 * 返回值：分组键字符串。
 */
function candidateReviewGroupKey(item) {
  return [
    String(item?.sourceWorkId || '').trim() || `work:unresolved:${String(item?.candidateId || '').trim()}`,
    candidateReviewEntityKey(item),
    String(item?.archetype || '').trim(),
    String(item?.dimension || '').trim()
  ].join('|');
}

/** 按复核分组切分批次，保证单批不混入不同作品、人物、性格或维度。
 * 参数：candidates 为候选数组；batchSize 为单批上限。
 * 返回值：包含 groupKey 和 items 的稳定批次数组。
 */
function buildReviewBatches(candidates, batchSize = MAX_BATCH_SIZE) {
  const limit = Math.min(MAX_BATCH_SIZE, Math.max(1, Number.parseInt(batchSize, 10) || MAX_BATCH_SIZE));
  const groups = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const groupKey = candidateReviewGroupKey(candidate);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(candidate);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
    .flatMap(([groupKey, values]) => {
      const ordered = values.slice().sort((left, right) => (
        (Number.isInteger(left.chapterIndex) ? left.chapterIndex : Number.MAX_SAFE_INTEGER)
          - (Number.isInteger(right.chapterIndex) ? right.chapterIndex : Number.MAX_SAFE_INTEGER)
          || left.candidateId.localeCompare(right.candidateId, 'en')
      ));
      const batches = [];
      for (let offset = 0; offset < ordered.length; offset += limit) {
        batches.push({ groupKey, items: ordered.slice(offset, offset + limit) });
      }
      return batches;
    });
}

/** 读取候选复核脚本参数，默认每批不超过 20 段且请求间隔不少于 2 秒。
 * 参数：argv 为命令行参数数组。
 * 返回值：规范化后的复核配置对象。
 */
function readOptions(argv) {
  const options = {
    intermediate: DEFAULT_INTERMEDIATE,
    output: DEFAULT_OUTPUT,
    baseUrl: DEFAULT_BASE_URL,
    token: process.env.MOLAN_CHARACTER_REVIEW_TOKEN || '',
    model: 'deepseek-v4-flash',
    batchSize: MAX_BATCH_SIZE,
    delayMs: MIN_DELAY_MS,
    retries: 2,
    maxCandidates: 0
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--intermediate') options.intermediate = path.resolve(argv[++index]);
    else if (value === '--output') options.output = path.resolve(argv[++index]);
    else if (value === '--base-url') options.baseUrl = String(argv[++index] || '').replace(/\/$/u, '');
    else if (value === '--token') options.token = String(argv[++index] || '');
    else if (value === '--model') options.model = String(argv[++index] || options.model);
    else if (value === '--batch-size') options.batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, Number.parseInt(argv[++index], 10) || MAX_BATCH_SIZE));
    else if (value === '--delay') options.delayMs = Math.max(MIN_DELAY_MS, Number(argv[++index]) || MIN_DELAY_MS);
    else if (value === '--retries') options.retries = Math.min(2, Math.max(0, Number.parseInt(argv[++index], 10) || 0));
    else if (value === '--max-candidates') options.maxCandidates = Math.max(0, Number.parseInt(argv[++index], 10) || 0);
  }
  return options;
}

/** 读取增量中间产物中的待复核候选，并按 candidateId 去重。
 * 参数：intermediateRoot 为中间产物目录。
 * 返回值：按稳定 candidateId 排序的候选数组。
 */
function readPendingCandidates(intermediateRoot) {
  const candidates = new Map();
  if (!fs.existsSync(intermediateRoot)) return [];
  for (const name of fs.readdirSync(intermediateRoot)) {
    if (!name.endsWith('.json') || name === 'progress.json') continue;
    try {
      const record = JSON.parse(fs.readFileSync(path.join(intermediateRoot, name), 'utf8'));
      for (const row of Array.isArray(record?.rows) ? record.rows : []) {
        if (!row.candidateId || row.classification?.modelReview !== 'pending') continue;
        if (!candidates.has(String(row.candidateId))) candidates.set(String(row.candidateId), {
          candidateId: String(row.candidateId),
          archetype: String(row.archetype || ''),
          dimension: String(row.dimension || ''),
          text: String(row.text || ''),
          sourceWorkId: String(row.sourceWorkId || ''),
          chapterIndex: Number.isInteger(row.provenance?.chapterIndex) ? row.provenance.chapterIndex : null,
          chapterTitle: String(row.provenance?.chapterTitle || ''),
          entityContext: row.entityContext && typeof row.entityContext === 'object'
            ? { before: String(row.entityContext.before || ''), after: String(row.entityContext.after || '') }
            : null,
          characterEvidence: row.characterEvidence && typeof row.characterEvidence === 'object'
            ? {
              status: String(row.characterEvidence.status || 'needs_context'),
              candidateCount: Number(row.characterEvidence.candidateCount) || 0,
              speakerCue: row.characterEvidence.speakerCue === true,
              candidateNames: Array.isArray(row.characterEvidence.candidateNames) ? row.characterEvidence.candidateNames.map(String) : [],
              evidenceSpans: row.characterEvidence.evidenceSpans || {},
              entityEvidenceSpans: Array.isArray(row.characterEvidence.entityEvidenceSpans)
                ? row.characterEvidence.entityEvidenceSpans.map(span => ({ ...span }))
                : []
            }
            : null,
          inputBinding: candidateInputBinding(row)
        });
      }
    } catch (_) {
      // 单个中间产物损坏时跳过，最终报告保留未复核数量而不伪造结论。
    }
  }
  return [...candidates.values()].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}

/** 读取已有复核结果用于断点续跑，不把候选原文写入复核结果。
 * 参数：outputPath 为复核结果 JSON 路径；model 为本次复核使用的模型标识。
 * 返回值：已复核 candidateId 集合、既有结果和既有错误数组。
 */
function readExistingReview(outputPath, model = '') {
  try {
    const value = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    const allReviews = Array.isArray(value?.reviews) ? value.reviews : [];
    const requestedModel = String(model || '').trim();
    const envelopeModel = String(value?.modelId || '').trim();
    const reviews = (envelopeModel && requestedModel && envelopeModel !== requestedModel)
      ? []
      : allReviews.filter(item => (!requestedModel || String(item?.modelId || '').trim() === requestedModel)
        && item?.promptVersion === REVIEW_PROMPT_VERSION
        && item?.modelId
        && hasCompleteInputBinding(item.inputBinding));
    return {
      reviews,
      reviewedIds: new Set(reviews.map(item => String(item?.candidateId || '')).filter(Boolean)),
      errors: Array.isArray(value?.errors) ? value.errors : []
    };
  } catch (_) {
    return { reviews: [], reviewedIds: new Set(), errors: [] };
  }
}

/** 组装只要求模型返回分类判定的批量提示，不要求模型改写或复述原文。
 * 参数：batch 为候选数组。
 * 返回值：发送到 /api/chat 的用户提示文本。
 */
function buildReviewPrompt(batch) {
  const items = batch.map(item => ({
    candidateId: item.candidateId,
    lexicalArchetype: item.archetype,
    lexicalDimension: item.dimension,
    sourceWorkId: item.sourceWorkId,
    chapterIndex: item.chapterIndex,
    chapterTitle: item.chapterTitle,
    characterEvidence: item.characterEvidence,
    reviewGroupKey: candidateReviewGroupKey(item),
    inputBinding: item.inputBinding,
    entityContext: item.entityContext,
    text: item.text
  }));
  return [
    '判断以下文学段落是否确实包含人物描写，并返回你确认后的性格类型、描写维度和人物实体线索。词法标签只是候选，可以被纠正。只做分类审核，不改写、不复述原文。',
    '若没有足够的人物主体或证据，isMatch 必须为 false；若不确定也必须为 false。characterEntityStatus 只能是 confirmed、candidate、needs_context 或 rejected。',
    'characterName 必须是原文中出现的具体人物名，不能填写“他/她/男人/众人”等泛称；entityEvidenceSpans 必须至少包含一条实体跨度，source 只能是 text、before 或 after，start/end 分别相对于候选文本或对应前后文，signal 必须与该范围原文完全一致，并且该范围必须覆盖 characterName。characterKey 由建库脚本根据作品 ID 和已验证人物名生成，模型不要填写。evidenceSpans 的 start/end 必须是候选文本的 UTF-16 偏移，且至少给出所确认维度的一段范围。只返回 JSON 对象：{"reviews":[{"candidateId":"...","isMatch":true,"confidence":0.9,"archetype":"冷静理智型","dimension":"psychology","characterEntityStatus":"confirmed","characterName":"张三","entityEvidenceSpans":[{"source":"text","start":0,"end":2,"signal":"张三"}],"evidenceSpans":{"psychology":{"start":0,"end":4}}}]}。',
    JSON.stringify(items)
  ].join('\n');
}

/** 从 JSON 或 SSE 响应中提取模型文本，拒绝把 HTTP 错误文本当作判定结果。
 * 参数：raw 为接口原始响应文本。
 * 返回值：模型输出文本；无法解析时抛出错误。
 */
function extractModelText(raw) {
  const source = String(raw || '');
  if (source.includes('data:')) {
    let output = '';
    for (const line of source.split(/\r?\n/u)) {
      const value = line.trim();
      if (!value.startsWith('data:')) continue;
      const data = value.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const packet = JSON.parse(data);
        const choice = packet.choices?.[0];
        const content = choice?.delta?.content ?? choice?.message?.content ?? '';
        output += Array.isArray(content) ? content.map(item => item?.text || '').join('') : String(content || '');
      } catch (_) {
        // 非 JSON 的 SSE 行不参与输出。
      }
    }
    if (output) return output;
  }
  try {
    const envelope = JSON.parse(source);
    const choice = envelope.choices?.[0];
    const content = choice?.message?.content ?? choice?.delta?.content ?? '';
    const output = Array.isArray(content) ? content.map(item => item?.text || '').join('') : String(content || '');
    if (output) return output;
  } catch (_) {
    // 下方统一抛出明确错误。
  }
  throw new Error('模型响应无法解析');
}

/** 解析模型 JSON 并只保留当前批次中的合法复核条目。
 * 参数：text 为模型输出；batch 为本次请求的候选；model 为模型标识。
 * 返回值：带时间、模型和判定字段的复核结果数组。
 */
function parseReviews(text, batch, model, promptVersion = REVIEW_PROMPT_VERSION) {
  const source = String(text || '').trim();
  let payload;
  try {
    payload = JSON.parse(source);
  } catch (_) {
    const match = source.match(/\{[\s\S]*\}/u);
    if (!match) throw new Error('模型未返回合法 JSON');
    payload = JSON.parse(match[0]);
  }
  const allowed = new Map(batch.map(item => [item.candidateId, item]));
  const reviewedAt = new Date().toISOString();
  return (Array.isArray(payload?.reviews) ? payload.reviews : []).map(item => {
    const candidateId = String(item?.candidateId || '');
    if (!allowed.has(candidateId)) return null;
    const confidence = Number(item?.confidence);
    const result = {
      candidateId,
      isMatch: item?.isMatch === true,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
      archetype: String(item?.archetype || '').trim(),
      dimension: String(item?.dimension || '').trim(),
      modelId: model,
      promptVersion,
      inputBinding: { ...(allowed.get(candidateId).inputBinding || {}) },
      reviewedAt
    };
    if (Object.prototype.hasOwnProperty.call(item || {}, 'characterEntityStatus')) {
      result.characterEntityStatus = String(item.characterEntityStatus || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(item || {}, 'characterKey')) {
      result.characterKey = String(item.characterKey || '').trim().slice(0, 120);
    }
    if (Object.prototype.hasOwnProperty.call(item || {}, 'characterName')) {
      result.characterName = String(item.characterName || '').trim().slice(0, 80);
    }
    if (Array.isArray(item?.entityEvidenceSpans)) {
      result.entityEvidenceSpans = item.entityEvidenceSpans.map(span => ({ ...span })).slice(0, 8);
    }
    if (item?.evidenceSpans && typeof item.evidenceSpans === 'object' && !Array.isArray(item.evidenceSpans)) {
      result.evidenceSpans = item.evidenceSpans;
    }
    return result;
  }).filter(Boolean);
}

/** 请求一批分类复核并按手册要求最多重试两次。
 * 参数：options 为复核配置；batch 为候选批次。
 * 返回值：模型确认的复核条目数组。
 */
async function reviewBatch(options, batch) {
  const token = String(options.token || '').trim();
  if (!token) throw new Error('缺少 MOLAN_CHARACTER_REVIEW_TOKEN 或 --token');
  const auth = /^Bearer\s/iu.test(token) ? token : `Bearer ${token}`;
  let lastError = null;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      let response;
      try {
        response = await fetch(`${options.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: auth },
          body: JSON.stringify({
            model: options.model,
            stage: 'single',
            thinking: false,
            reasoningEffort: 'none',
            temperature: 0.1,
            max_tokens: 2000,
            jsonMode: true,
            messages: [
              { role: 'system', content: '你是人物描写候选的严格分类审校器。只返回指定 JSON，不改写原文。' },
              { role: 'user', content: buildReviewPrompt(batch) },
              { role: 'user', content: '只返回一个合法 JSON 对象，不要解释或 Markdown。' }
            ]
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
      const raw = await response.text();
      if (!response.ok) throw new Error(`模型接口 HTTP ${response.status}：${raw.slice(0, 300)}`);
      return parseReviews(extractModelText(raw), batch, options.model, REVIEW_PROMPT_VERSION);
    } catch (error) {
      lastError = error;
      if (attempt < options.retries) continue;
    }
  }
  throw lastError || new Error('模型复核失败');
}

/** 以 UTF-8 JSON 写入复核结果，结果只包含判定和哈希标识而不保存候选原文。
 * 参数：filePath 为结果文件路径；value 为可序列化结果对象。
 * 返回值：无返回值。
 */
function writeReview(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** 批量执行候选模型复核并保存可断点续跑的判定文件。
 * 参数：options 为 readOptions 返回的复核配置。
 * 返回值：本次复核汇总对象。
 */
async function run(options) {
  const candidates = readPendingCandidates(options.intermediate);
  const existing = readExistingReview(options.output, options.model);
  const pendingCandidates = candidates.filter(item => !existing.reviewedIds.has(item.candidateId)).slice(0, options.maxCandidates || undefined);
  const batches = buildReviewBatches(pendingCandidates, options.batchSize);
  if (pendingCandidates.length > 0 && !String(options.token || '').trim()) throw new Error('缺少 MOLAN_CHARACTER_REVIEW_TOKEN 或 --token；未发送任何模型请求');
  const reviews = existing.reviews.slice();
  const errors = existing.errors.slice();
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex].items;
    const groupKey = batches[batchIndex].groupKey;
    try {
      const next = await reviewBatch(options, batch);
      const seen = new Set(reviews.map(item => String(item.candidateId)));
      for (const item of next) {
        if (!seen.has(item.candidateId)) reviews.push(item);
      }
      if (!next.length) errors.push({ groupKey, candidateIds: batch.map(item => item.candidateId), reason: '模型未返回当前批次的有效 candidateId', recordedAt: new Date().toISOString() });
    } catch (error) {
      errors.push({ groupKey, candidateIds: batch.map(item => item.candidateId), reason: String(error?.message || error).slice(0, 400), recordedAt: new Date().toISOString() });
    }
    writeReview(options.output, {
      schemaVersion: 'corpus-v3-classification-review-2',
      generatedAt: new Date().toISOString(),
      modelId: options.model,
      promptVersion: REVIEW_PROMPT_VERSION,
      reviews,
      errors
    });
    if (batchIndex < batches.length - 1) await new Promise(resolve => setTimeout(resolve, options.delayMs));
  }
  const reviewedIds = new Set(reviews.map(item => String(item.candidateId)));
  const summary = {
    candidateCount: candidates.length,
    reviewedCount: candidates.filter(item => reviewedIds.has(item.candidateId)).length,
    pendingCount: candidates.filter(item => !reviewedIds.has(item.candidateId)).length,
    reviewGroupCount: new Set(candidates.map(candidateReviewGroupKey)).size,
    reviewBatchCount: batches.length,
    errorBatchCount: errors.length,
    output: options.output
  };
  writeReview(options.output, {
    schemaVersion: 'corpus-v3-classification-review-2',
    generatedAt: new Date().toISOString(),
    modelId: options.model,
    promptVersion: REVIEW_PROMPT_VERSION,
    summary,
    reviews,
    errors
  });
  return summary;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  run(readOptions(process.argv.slice(2)))
    .then(summary => console.log(JSON.stringify(summary, null, 2)))
    .catch(error => {
      console.error(String(error?.message || error));
      process.exitCode = 1;
    });
}

export { readOptions, readPendingCandidates, readExistingReview, candidateReviewGroupKey, buildReviewBatches, parseReviews, reviewBatch, run };
