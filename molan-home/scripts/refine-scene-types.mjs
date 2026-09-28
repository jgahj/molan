// 使用本地 /api/chat 的 flash 模型对日常粗标样本做批量精标。
// 脚本默认只读取匿名化文本，失败批次不会改写样本库；需要 MOLAN_TOKEN 或账号密码。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEFAULT_DATA_PATH = path.join(REPO_ROOT, 'data', 'paragraph-samples.json');
const SCENE_TYPES = ['日常', '对峙', '打脸', '危机', '修炼', '情感'];

/** 从命令行或环境变量读取字符串参数，空值时使用默认值。 */
function readString(args, name, fallback = '') {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? String(args[index + 1]) : fallback;
}

/** 从命令行读取正整数参数，防止批次大小和请求数量失控。 */
function readPositiveInt(args, name, fallback) {
  const value = Number(readString(args, name, ''));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** 登录本地服务并取得精标请求所需的 bearer token。 */
async function login(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.token) throw new Error(`本地登录失败 HTTP ${response.status}`);
  return String(payload.token);
}

/** 读取 SSE 响应并拼接模型输出文本，兼容 message/content 两种增量结构。 */
async function readStreamText(response) {
  const raw = await response.text();
  let output = '';
  for (const line of String(raw).split(/\r?\n/u)) {
    const value = line.trim();
    if (!value.startsWith('data:') || value.slice(5).trim() === '[DONE]') continue;
    try {
      const packet = JSON.parse(value.slice(5).trim());
      const choice = packet && packet.choices && packet.choices[0];
      const delta = choice && choice.delta;
      output += typeof (delta && delta.content) === 'string' ? delta.content : typeof (choice && choice.message && choice.message.content) === 'string' ? choice.message.content : typeof packet.content === 'string' ? packet.content : '';
    } catch (_) {}
  }
  return output.trim();
}

/** 解析精标模型返回的 JSON，并只接受合法场景类型与已知样本 id。 */
function parseRefinement(text, allowedIds) {
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  let parsed;
  try { parsed = JSON.parse(source); } catch (_) {
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start < 0 || end <= start) return [];
    try { parsed = JSON.parse(source.slice(start, end + 1)); } catch (_) { return []; }
  }
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.items) ? parsed.items : [];
  return rows.map(item => ({ id: String(item && item.id || ''), sceneType: String(item && (item.sceneType || item.scene_type) || '') }))
    .filter(item => allowedIds.has(item.id) && SCENE_TYPES.includes(item.sceneType));
}

/** 请求一个批次的日常样本精标结果，模型不可用时抛出可定位错误。 */
async function refineBatch(baseUrl, token, batch, model) {
  const prompt = JSON.stringify(batch.map(sample => ({ id: sample.id, text: sample.anonymizedText || sample.text || '' })));
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model,
      stream: true,
      jsonMode: true,
      stage: 'skill_analysis',
      max_tokens: Math.max(500, batch.length * 70),
      temperature: 0.1,
      messages: [
        { role: 'system', content: '你是小说段落场景精标器。只返回合法 JSON，不要 Markdown。对每条样本选择一个 sceneType：日常、对峙、打脸、危机、修炼、情感。以段落主要冲突和行动为准，不能因为单个词机械判断。格式：{"items":[{"id":"原 id","sceneType":"场景类型"}]}。' },
        { role: 'user', content: `待标注样本：${prompt}` }
      ]
    })
  });
  if (!response.ok) throw new Error(`精标请求失败 HTTP ${response.status}`);
  return parseRefinement(await readStreamText(response), new Set(batch.map(sample => String(sample.id))));
}

/** 重新统计段落库场景分布并写入更新时间与总数。 */
function refreshMetadata(payload) {
  const sceneTypes = {};
  let totalSamples = 0;
  for (const bucket of payload.buckets || []) {
    bucket.samples = Array.isArray(bucket.samples) ? bucket.samples : [];
    bucket.sampleCount = bucket.samples.length;
    totalSamples += bucket.samples.length;
    bucket.samples.forEach(sample => { sample.sceneType = SCENE_TYPES.includes(sample.sceneType) ? sample.sceneType : '日常'; sceneTypes[sample.sceneType] = (sceneTypes[sample.sceneType] || 0) + 1; });
  }
  payload.schemaVersion = 'paragraph-samples-2';
  payload.totalSamples = totalSamples;
  payload.sceneTypes = sceneTypes;
  payload.generatedAt = Date.now();
  return payload;
}

/** 以原子方式保存精标结果，避免中途退出破坏样本库。 */
function writeJsonAtomic(filePath, payload) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

/** 批量精标日常样本并将可解析结果合并回段落库。 */
export async function refineSceneTypes(options = {}) {
  const args = Array.isArray(options.args) ? options.args : [];
  const baseUrl = (readString(args, '--base-url', process.env.MOLAN_BASE_URL || 'http://127.0.0.1:3000')).replace(/\/+$/u, '');
  const dataPath = path.resolve(readString(args, '--data', options.dataPath || DEFAULT_DATA_PATH));
  const batchSize = readPositiveInt(args, '--batch-size', Number(options.batchSize) || 20);
  const maxBatches = readPositiveInt(args, '--max-batches', Number(options.maxBatches) || Number.MAX_SAFE_INTEGER);
  const model = readString(args, '--model', process.env.MOLAN_REFINE_MODEL || 'deepseek-v4-flash');
  const payload = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const samples = (payload.buckets || []).flatMap(bucket => Array.isArray(bucket.samples) ? bucket.samples : []).filter(sample => String(sample.sceneType || '日常') === '日常');
  let token = readString(args, '--token', process.env.MOLAN_TOKEN || '');
  if (!token) {
    const email = readString(args, '--email', process.env.MOLAN_EVAL_EMAIL || '');
    const password = readString(args, '--password', process.env.MOLAN_EVAL_PASSWORD || '');
    if (!email || !password) return { status: 'blocked', reason: 'missing_token_or_credentials', sampleCount: samples.length };
    token = await login(baseUrl, email, password);
  }
  let batches = 0;
  let updated = 0;
  for (let start = 0; start < samples.length && batches < maxBatches; start += batchSize) {
    const batch = samples.slice(start, start + batchSize);
    const rows = await refineBatch(baseUrl, token, batch, model);
    const byId = new Map(rows.map(row => [row.id, row.sceneType]));
    batch.forEach(sample => { const next = byId.get(String(sample.id)); if (next && next !== sample.sceneType) { sample.sceneType = next; updated += 1; } });
    batches += 1;
    console.log(`[refine] 已完成 ${batches} 批，更新 ${updated} 条`);
  }
  refreshMetadata(payload);
  if (updated > 0) writeJsonAtomic(dataPath, payload);
  return { status: 'ready', dataPath, batches, updated, totalDailyCandidates: samples.length, sceneTypes: payload.sceneTypes };
}

/** 命令行入口：没有本地凭据时只报告阻断原因，不修改数据文件。 */
export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('用法：node scripts/refine-scene-types.mjs --token TOKEN [--batch-size 20] [--max-batches N]');
    return 0;
  }
  try {
    const result = await refineSceneTypes({ args: argv });
    if (result.status === 'blocked') { console.error('[refine] 缺少 MOLAN_TOKEN 或登录参数，未修改样本库'); return 2; }
    console.log(`[refine] 完成：${result.updated} 条更新，场景分布 ${JSON.stringify(result.sceneTypes)}`);
    return 0;
  } catch (error) {
    console.error(`[refine] 失败：${error.message}`);
    return 1;
  }
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) process.exitCode = await main();
