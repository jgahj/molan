#!/usr/bin/env node
// 端到端验证脚本：以 two-pass 配置请求 /api/chat，抓取 molan_usage 中的
// aiFlavor 两轮检测报告与 characterMaterial 注入审计，验证报告随用量事件下发（不静默放行）。
// 依赖本地服务（默认 http://127.0.0.1:3000）与 mock 上游（127.0.0.1:9999）。
const BASE = process.env.MOLAN_BASE_URL || 'http://127.0.0.1:3000';
const EMAIL = process.env.MOLAN_EVAL_EMAIL || 'eval_final_20260830230718@test.com';
const PASSWORD = process.env.MOLAN_EVAL_PASSWORD || 'Eval!2026pass';

/** 登录评测账号并返回 token。 */
async function login() {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error('登录失败 HTTP ' + res.status);
  return data.token;
}

/** 发起一次 two-pass 写作请求并聚合 molan_usage。 */
async function main() {
  const token = await login();
  const body = {
    messages: [{ role: 'user', content: '第一章大纲：废柴少年陆沉在宗门大比前夜意外唤醒体内沉眠的龙魂。请写出正文段落。' }],
    stream: true,
    temperature: 0.85,
    max_tokens: 2000,
    jsonMode: false,
    stage: 'writing',
    twoPassHumanize: true,
    characterMaterial: { enabled: true, proseTask: true, mode: 'strong', genre: '仙侠' }
  };
  const res = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  let usage = null;
  for (const line of String(raw).split(/\r?\n/)) {
    const v = line.trim();
    if (!v.startsWith('data:')) continue;
    const val = v.slice(5).trim();
    if (!val || val === '[DONE]') continue;
    try {
      const pkt = JSON.parse(val);
      if (pkt.molan_usage) usage = pkt.molan_usage;
    } catch { /* 跳过非 JSON 行 */ }
  }
  if (!usage) throw new Error('未捕获 molan_usage 事件');
  console.log('model =', usage.model);
  console.log('twoPassHumanize =', usage.twoPassHumanize);
  console.log('characterMaterial.sampleCount =', usage.characterMaterial && usage.characterMaterial.sampleCount);
  console.log('characterMaterial.mode =', usage.characterMaterial && usage.characterMaterial.mode);
  console.log('aiFlavor =', JSON.stringify(usage.aiFlavor, null, 2));
}

main().catch(err => { console.error('[verify] 失败:', err.message); process.exit(1); });
