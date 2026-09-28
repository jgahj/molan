#!/usr/bin/env node
// 端到端 mock 上游：模拟两遍生成编排所需的 OpenAI 兼容 /chat/completions SSE 接口。
// 第一遍（请求不含「改写边界」）返回 AI 味超标的均匀短句文本；
// 第二遍（含「改写边界」）返回长短句交错、段落错落的低 AI 味文本。
// 用途：在上游 API 余额不足时验证 server.js 两遍编排链路（登录→chat→检测→改写→molan_usage 报告）。
import http from 'node:http';

const HIGH_AI_FLAVOR_DRAFT = [
  '他缓缓地抬起头，眼中闪过一丝震撼。他的心跳骤然加速。他感到一种前所未有的震撼。',
  '他不可抑制地颤抖起来。他的呼吸微微地急促。他的眼中再次闪过一丝震撼。',
  '他深深地吸了一口气。他的内心久久不能平静。他的思绪万般涌动。',
  '他感到无与伦比的震撼。这个景象令人叹为观止。他久久不能平静。',
  '他的眼神变得深邃起来。他的呼吸变得急促起来。他的心跳变得剧烈起来。'
].join('\n');

const LOW_AI_FLAVOR_TEXT = [
  '山门开在两崖之间，风从谷底灌上来，吹得他袖子贴着手臂。',
  '他站了半炷香。',
  '石阶上生了苔，一脚踩下去，鞋底打滑——他伸手抓住旁边的铁索，掌心立刻传来一股凉意，凉意底下还带着锈味。崖下云雾翻涌，看不见底。他咽了口唾沫，继续往上爬。',
  '爬到第三百级的时候，膝盖开始发酸。他数着数，数到三百二十七，忘了。重数。又是三百多。',
  '「你就是新来的？」',
  '声音从头顶落下来。他抬头，一个青袍道人坐在崖边的松枝上，腿悬着晃，手里捏着个酒葫芦。',
  '「测试灵根的地方在哪？」他问。',
  '道人没答，把酒葫芦扔下来。他手忙脚乱接住，酒液泼了半袖子。',
  '「喝完再问。」道人说，「一口。」'
].join('\n');

/** 生成 SSE chunk：OpenAI 兼容的 delta 增量格式。 */
function sseDelta(content) {
  return 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content } }] }) + '\n\n';
}

/** 生成 SSE usage 尾包。 */
function sseUsage(promptTokens, completionTokens) {
  return 'data: ' + JSON.stringify({
    choices: [{ index: 0, finish_reason: 'stop' }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens }
  }) + '\n\n';
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404); res.end('not found'); return;
  }
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    let isSecondPass = false;
    let promptChars = 500;
    try {
      const body = JSON.parse(raw);
      promptChars = Math.ceil(String(raw).length / 4);
      isSecondPass = (body.messages || []).some(m => String(m.content || '').includes('改写边界'));
    } catch (_) { /* 解析失败按第一遍处理 */ }
    const text = isSecondPass ? LOW_AI_FLAVOR_TEXT : HIGH_AI_FLAVOR_DRAFT;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    // 按 40 字切片流式下发，模拟真实流
    for (let i = 0; i < text.length; i += 40) res.write(sseDelta(text.slice(i, i + 40)));
    res.write(sseUsage(promptChars, Math.ceil(text.length)));
    res.write('data: [DONE]\n\n');
    res.end();
    console.log('[mock-upstream] served', isSecondPass ? 'SECOND pass (low AI flavor)' : 'FIRST pass (high AI flavor)');
  });
});

server.listen(9999, '127.0.0.1', () => console.log('[mock-upstream] listening on http://127.0.0.1:9999'));
