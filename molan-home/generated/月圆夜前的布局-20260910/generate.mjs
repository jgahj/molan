import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outputDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(outputDirectory, '../..');
const revising = process.argv.includes('--revise');
const chapterPath = path.join(outputDirectory, revising ? '月圆夜前的布局-定稿.md' : '月圆夜前的布局.md');
const recordPath = path.join(outputDirectory, revising ? '生成记录-定稿.json' : '生成记录.json');
const rawPath = path.join(outputDirectory, revising ? 'luna-final-original.txt' : 'luna-original.txt');
const modelId = 'gpt-5.6-luna';
const baseUrl = 'http://127.0.0.1:3000';

export function parseLunaStream(rawStream) {
  let removedBillingEvents = 0;
  let removedHeartbeats = 0;
  const cleanedStream = rawStream
    .replace(/data: (\{"molan_billing":[^\r\n]*\})\r?\n\r?\n/g, () => {
      removedBillingEvents += 1;
      return '';
    })
    .replace(/: (?:ping|keep-alive)\r?\n\r?\n/g, () => {
      removedHeartbeats += 1;
      return '';
    });
  let output = '';
  let usage = null;
  let finishReason = null;
  const responseModels = new Set();
  const streamErrors = [];
  for (const event of cleanedStream.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!data || data === '[DONE]') continue;
    const packet = JSON.parse(data);
    if (packet.error || packet.molan_error) streamErrors.push('上游返回错误事件');
    if (packet.model) responseModels.add(packet.model);
    if (packet.molan_usage) usage = packet.molan_usage;
    const choice = packet.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    output += choice?.delta?.content || choice?.message?.content || choice?.text || '';
  }
  return { output, usage, finishReason, responseModels, streamErrors, removedBillingEvents, removedHeartbeats };
}

async function main() {
  for (const target of [chapterPath, recordPath, rawPath]) {
    assert.ok(!existsSync(target), `禁止覆盖已有文件：${path.basename(target)}`);
  }

  const existingRunner = readFileSync(path.join(projectDirectory, 'scripts/generate-fanren-10-chapters.mjs'), 'utf8');
  const email = existingRunner.match(/const EMAIL = '([^']+)'/)?.[1];
  const password = existingRunner.match(/const PASSWORD = '([^']+)'/)?.[1];
  assert.ok(email && password, '没有找到项目现有生成脚本的登录配置');

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15000)
  });
  assert.ok(loginResponse.ok, `项目登录失败：HTTP ${loginResponse.status}`);
  const login = await loginResponse.json();
  assert.ok(login.token, '项目未返回有效登录会话');
  const headers = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };

  const modelsResponse = await fetch(`${baseUrl}/api/models`, { headers, signal: AbortSignal.timeout(15000) });
  assert.ok(modelsResponse.ok, `模型核验失败：HTTP ${modelsResponse.status}`);
  const models = await modelsResponse.json();
  assert.ok(models.models.some(model => model.id === modelId), '当前账号无法使用 Luna');
  assert.ok(models.access.canChooseModel || models.access.defaultModel === modelId, '当前账号会被路由到非 Luna 模型');

  const originalPrompt = readFileSync(path.join(outputDirectory, '提示词.md'), 'utf8');
  const prompt = revising
    ? `${originalPrompt}\n\n【待修订的 Luna 首稿】\n${readFileSync(path.join(outputDirectory, 'luna-original.txt'), 'utf8')}\n\n【本次定向修订要求，优先落实】\n${readFileSync(path.join(outputDirectory, '修订要求.md'), 'utf8')}`
    : originalPrompt;
  const startedAt = new Date().toISOString();
  console.log('LUNA_REQUEST_STARTED', JSON.stringify({ model: modelId, stage: 'writing', startedAt }));
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: modelId,
      stage: 'writing',
      genre: '玄幻',
      max_tokens: 6500,
      temperature: 0.82,
      twoPassHumanize: false,
      messages: [
        { role: 'system', content: '你是中文玄幻小说作者。按用户给定设定写完整章节，保留人名和剧情因果，控制篇幅，只交付标题及正文。' },
        { role: 'user', content: prompt }
      ]
    }),
    signal: AbortSignal.timeout(600000)
  });
  assert.ok(response.ok, `Luna 生成失败：HTTP ${response.status}；未自动重试`);

  let rawStream = '';
  const decoder = new TextDecoder();
  let nextProgress = 100000;
  for await (const chunk of response.body) {
    rawStream += decoder.decode(chunk, { stream: true });
    if (rawStream.length >= nextProgress) {
      console.log('LUNA_TRANSPORT_CHARACTERS', rawStream.length);
      nextProgress += 100000;
    }
  }
  rawStream += decoder.decode();
  const { output, usage, finishReason, responseModels, streamErrors, removedBillingEvents, removedHeartbeats } = parseLunaStream(rawStream);
  assert.ok(output.trim(), 'Luna 未返回正文；未自动重试');
  writeFileSync(rawPath, output, { encoding: 'utf8', flag: 'wx' });

  const trimmed = output.trim().replace(/^```(?:markdown|md)?\s*\n/, '').replace(/\n```\s*$/, '');
  const body = trimmed.replace(/^(?:#{1,6}\s*)?(?:《月圆夜前的布局》|月圆夜前的布局)\s*\n/, '').trim();
  const chapter = `# 月圆夜前的布局\n\n${body}\n`;
  const nonWhitespaceCharacters = [...body.replace(/\s/g, '')].length;
  const chineseCharacters = (body.match(/\p{Script=Han}/gu) || []).length;
  const requiredTerms = ['罗祖云山界', '大圣', '伪神', '神境', '神尊', '张若尘', '十界之战', '姑射静', '元会', '天阁目', '姑射云琉', '云琉神殿', '木灵希', '地姥', '蚩刑天', '天魔石刻', '天魔贪狼图', '神储卷', '日晷', '连我俗世神话张若尘都不知道，找死！', '地姥欲将天阁目嫁给我', '月圆夜第二天必须离开'];
  const missingTerms = requiredTerms.filter(term => !body.includes(term));
  const record = {
    title: '月圆夜前的布局',
    revision: revising ? '定向修订' : '首稿',
    endpoint: `${baseUrl}/api/chat`,
    requestedModel: modelId,
    modelId: usage?.modelId,
    providerModel: usage?.providerModel,
    responseModels: [...responseModels],
    stage: 'writing',
    startedAt,
    completedAt: new Date().toISOString(),
    requestId: usage?.requestId,
    status: usage?.status,
    finishReason: usage?.finishReason || finishReason,
    tokens: { prompt: usage?.promptTokens, completion: usage?.completionTokens, total: usage?.totalTokens },
    durationMs: usage?.durationMs,
    creditCost: usage?.creditCost,
    defaultWritingSkill: usage?.skillAudit?.defaultWritingSkill,
    skillAuditStatus: usage?.skillAudit?.status,
    promptSha256: createHash('sha256').update(prompt).digest('hex'),
    originalSha256: createHash('sha256').update(output).digest('hex'),
    chapterSha256: createHash('sha256').update(chapter).digest('hex'),
    chineseCharacters,
    nonWhitespaceCharacters,
    missingTerms,
    streamErrors,
    transport: { removedBillingEvents, removedHeartbeats },
    postprocessing: '仅统一标题和移除可能的 Markdown 外层代码围栏，正文未人工改写。'
  };
  writeFileSync(chapterPath, chapter, { encoding: 'utf8', flag: 'wx' });
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log('LUNA_GENERATION_RECORD', JSON.stringify(record));
  assert.equal(streamErrors.length, 0, '流中出现错误，需检查已保存结果');
  assert.equal(usage?.modelId, modelId, '返回的模型与 Luna 不一致');
  assert.equal(usage?.providerModel, modelId, '上游模型与 Luna 不一致');
  assert.equal(usage?.status, 'completed', '生成状态不是 completed');
  assert.notEqual(record.finishReason, 'length', '生成被截断');
  assert.ok(chineseCharacters >= 2000 && nonWhitespaceCharacters <= 3000, '章节字数需检查');
  assert.deepEqual(missingTerms, [], '存在缺少的关键设定或原句');
  console.log('PASS：Luna 已完成生成，字数与关键设定检查通过。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
