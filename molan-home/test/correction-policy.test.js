const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-correction-'));
process.env.MOLAN_DATA_DIR = tempDataDir;
process.env.MOLAN_CONFIG_DIR = tempDataDir;
process.env.MOLAN_REQUIRE_SQLITE = '0';
process.env.MOLAN_PUBLIC_MODE = '0';

const policy = require('../correction-policy');
const server = require('../server');

test('keeps the correction library universal and project-neutral', () => {
  assert.match(policy.UNIVERSAL_CORRECTION_POLICY_PROMPT, /所有用户、所有作品/);
  assert.match(policy.UNIVERSAL_CORRECTION_POLICY_PROMPT, /保留原有事实、设定、剧情顺序/);
  assert.doesNotMatch(policy.UNIVERSAL_CORRECTION_POLICY_PROMPT, /叶辰|叶灵儿|玄天宗|轮回神玉/);
});

test('correction prompt preserves legitimate narration and does not impose paragraph quotas', () => {
  assert.match(policy.UNIVERSAL_CORRECTION_POLICY_PROMPT, /允许有个人声音的直接心理/);
  assert.match(policy.UNIVERSAL_CORRECTION_POLICY_PROMPT, /短段、拟声独立成段和心理停顿本身不是缺陷/);
  assert.match(policy.UNIVERSAL_CORRECTION_POLICY_PROMPT, /不强制每段句数/);
  assert.doesNotMatch(policy.UNIVERSAL_CORRECTION_POLICY_PROMPT, /必须彻底清零为0处|旁白只写可观察物理事实|严禁将“咚/);
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'humanize-policy-service.js'), 'utf8');
  const rewrite = source.slice(source.indexOf('function buildHumanizePassMessages('), source.indexOf('function mergeUsageSum('));
  assert.match(rewrite, /不强制每段句数/);
  assert.doesNotMatch(rewrite, /严格控制在0~2|白金名家级深度精修|严禁零散短句独立成段/);
});

test('scans reusable correction patterns without banning valid scene-bound metaphors', () => {
  const risky = policy.scanUniversalCorrectionRisks('所有人都愣住了。她的目光如刀，嘴角勾起一抹冷笑。声音从夜色里漏出来。');
  assert.equal(risky.enabled, true);
  assert.equal(risky.status, 'needs_review');
  assert.ok(risky.matchedRuleIds.includes('R-05-formulaic-metaphor'));
  assert.ok(risky.matchedRuleIds.includes('R-07-formulaic-crowd'));
  assert.ok(risky.matchedRuleIds.includes('R-14-template-smile'));
  assert.ok(risky.matchedRuleIds.includes('R-01-sensory-personification'));

  const valid = policy.scanUniversalCorrectionRisks('雨水沿着瓦檐落下，像一串被风拨乱的珠子，砸在木窗上。');
  assert.equal(valid.status, 'passed');
});

test('scans extended correction patterns from 纠错库: narrator judgment, contrast cliches, abstract wounds, and micro-timing', () => {
  const judgment = policy.scanUniversalCorrectionRisks('为了两个被盯上的人得罪他，实在不值当。他的成长速度太恐怖了。');
  assert.ok(judgment.matchedRuleIds.includes('R-19-narrator-value-judgment'));
  assert.ok(judgment.matchedRuleIds.includes('R-11-evidence-overclaim'));

  const contrast = policy.scanUniversalCorrectionRisks('普通人未必能分辨出来，他却太熟悉这种味道。');
  assert.ok(contrast.matchedRuleIds.includes('R-20-contrast-cliche'));

  const wound = policy.scanUniversalCorrectionRisks('刚散去一些的淤伤像被重新凿了一遍。身体如断线风筝般倒飞。');
  assert.ok(wound.matchedRuleIds.includes('R-21-abstract-wound-cliche'));
  assert.ok(wound.matchedRuleIds.includes('R-05-formulaic-metaphor'));

  const timing = policy.scanUniversalCorrectionRisks('他嘴角的笑停了半息，眼神发冷。');
  assert.ok(timing.matchedRuleIds.includes('R-22-micro-timing-cliche'));

  const metaphors = policy.scanUniversalCorrectionRisks('他目光锐利如刀，冷硬如刀削，宛如一盘散落的棋子，又像一条受了惊的丧家之犬。');
  assert.ok(metaphors.matchedRuleIds.includes('R-05-formulaic-metaphor'));

  const quantities = policy.scanUniversalCorrectionRisks('他自有一股温文尔雅的书卷气，声音带上一丝颤抖。');
  assert.ok(quantities.matchedRuleIds.includes('R-12-decorative-quantity'));

  // R-40 植物神经与微小肌群痉挛套路 & R-41 隐形翻译腔
  const somatic = policy.scanUniversalCorrectionRisks('他只觉得喉咙发紧，指节捏得发白，呼吸骤然一滞，心跳漏了一拍，下颌线骤然收紧，后颈汗毛倒竖，手心全是冷汗。');
  assert.ok(somatic.matchedRuleIds.includes('R-40-somatic-reflex-cliche'));

  const translationese = policy.scanUniversalCorrectionRisks('屋内的残破在这一刻显得格外刺眼，无不在昭示着曾经的惨烈，带着一种不容置疑的压迫，仿佛只要轻轻一碰就会散架。');
  assert.ok(translationese.matchedRuleIds.includes('R-41-hidden-translationese'));

  // 中二战力描写应当通过，不被误杀
  const chuunibyouText = '这一刀斩裂了百里劫云，九转焚天印爆发出焚尽苍穹的九重离火，神魔辟易的纯粹肉体力量瞬间贯穿山峦。';
  const chuunibyouCheck = policy.scanUniversalCorrectionRisks(chuunibyouText);
  assert.equal(chuunibyouCheck.status, 'passed');
});

test('injects the policy for writing stages and keeps dynamic context after it', () => {
  const messages = [{ role: 'system', content: '基础角色\n\n<!-- molan-dynamic-context-v2 -->\n当前章节' }, { role: 'user', content: '写正文' }];
  assert.equal(server.correctionPolicyEnabled('writing', {}), true);
  assert.equal(server.correctionPolicyEnabled('single', {}), true);
  assert.equal(server.correctionPolicyEnabled('writing', { correctionPolicy: false }), true);
  assert.equal(server.correctionPolicyEnabled('writing', { jsonMode: true }), false);
  const injected = server.injectUniversalCorrectionPolicy(messages, true);
  assert.match(injected[0].content, /molan-universal-correction-policy-v1/);
  assert.ok(injected[0].content.indexOf('molan-universal-correction-policy-v1') < injected[0].content.indexOf('molan-dynamic-context-v2'));
  const twice = server.injectUniversalCorrectionPolicy(injected, true);
  assert.equal(twice[0].content, injected[0].content);
});

test('automatically applies and audits the default writing Skill', () => {
  const skill = server.defaultWritingSkillRecord();
  assert.equal(skill.id, server.DEFAULT_WRITING_SKILL_ID);
  const ensured = server.ensureDefaultWritingSkill([
    { role: 'system', content: '你负责写作。' },
    { role: 'user', content: '写一段正文。' }
  ], 'writing');
  assert.equal(ensured.injected, true);
  assert.match(ensured.messages[0].content, /MOLAN_SKILL_BLOCK_BEGIN/);
  assert.match(ensured.messages[0].content, /纠错库/);
  const auditRequest = server.addDefaultWritingSkillAudit({}, skill);
  const audit = server.buildSkillAudit({ user: { email: 'default-skill-test@example.com' } }, ensured.messages, auditRequest);
  assert.equal(audit.status, 'verified');
  assert.deepEqual(audit.actualSkillIds, [server.DEFAULT_WRITING_SKILL_ID]);
});

test('all browser writing pipelines enable the universal correction pass', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'pages', 'editor.js'), 'utf8');
  const home = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  for (const source of [editor, home]) {
    assert.match(source, /const shouldCorrection = mode === 'write'/);
    assert.match(source, /!shouldAnalyzeSkill && !shouldHumanize && !shouldCorrection/);
    assert.match(source, /correction: true,[\s\S]{0,80}skillMode: 'humanize'/);
  }
  assert.match(editor, /UNIVERSAL_CORRECTION_PATTERNS/);
});

test('covers R-01 through R-50 and detects extended rules R-42 to R-50', () => {
  // 验证 prompt 完整覆盖 R-01 到 R-50
  for (let i = 1; i <= 50; i++) {
    const code = 'R-' + (i < 10 ? '0' + i : String(i));
    assert.ok(policy.UNIVERSAL_CORRECTION_POLICY_PROMPT.includes(code), 'Missing in prompt: ' + code);
  }

  // R-42 变种指骨/骨节泛白
  const boneWhite = policy.scanUniversalCorrectionRisks('他的指骨泛白，死死攥着剑柄。');
  assert.ok(boneWhite.matchedRuleIds.includes('R-42-bone-whitening-mutation'));

  // R-43 机械节律脉动与抽动套路
  const pulsing = policy.scanUniversalCorrectionRisks('胸口一下一下地抽痛，伤势顺着脉搏跳动。');
  assert.ok(pulsing.matchedRuleIds.includes('R-43-rhythmic-pulsing-cliche'));

  // R-44 网游任务惩罚弹窗式四字通告
  const quest = policy.scanUniversalCorrectionRisks('此令一下，违约者抽取生魂，当为矿奴。');
  assert.ok(quest.matchedRuleIds.includes('R-44-quest-penalty-staccato'));

  // R-45 商业单章篇幅硬标准（超 3000 字超标）
  const longText = '正文段落。'.repeat(650); // 3250 字
  const lengthCheck = policy.scanUniversalCorrectionRisks(longText);
  assert.ok(lengthCheck.matchedRuleIds.includes('R-45-chapter-length-standard'));

  // R-46 滥用盯住制造虚假紧张感
  const staring = policy.scanUniversalCorrectionRisks('他死死盯着那本账簿，又低头盯着地面。');
  assert.ok(staring.matchedRuleIds.includes('R-46-excessive-staring-cliche'));

  // R-47 网剧相声式嘴炮互怼与接梗
  const banter = policy.scanUniversalCorrectionRisks('“那你还不感动？”“我只担心你杀得不够快。”“你对我始终没有信任。”');
  assert.ok(banter.matchedRuleIds.includes('R-47-banter-pingpong-cliche'));

  // R-48 反砖石大段与断崖单句
  const brick = policy.scanUniversalCorrectionRisks('超长砖石段落。'.repeat(40)); // 360 字不换行
  assert.ok(brick.matchedRuleIds.includes('R-48-brick-paragraph-cliche'));

  // R-49 无因果铺垫的空降偶遇救场
  const airdrop = policy.scanUniversalCorrectionRisks('主角开着车突然看到前方出现了一片火海，救下了众人。');
  assert.ok(airdrop.matchedRuleIds.includes('R-49-isolated-airdrop-rescue'));

  // R-50 段末假深刻断言金句
  const fakeDeep = policy.scanUniversalCorrectionRisks('这个举动很轻，却足够改变战局。');
  assert.ok(fakeDeep.matchedRuleIds.includes('R-50-narrator-depth-deprivation'));
});

test('loads structured data from data/correction-library correctly', () => {
  const lib = policy.getCorrectionLibrary();
  assert.ok(lib, 'Structured library must be loaded');
  assert.ok(lib.rules.length >= 46, 'Rules count must be >= 46');
  assert.ok(lib.cases.length >= 200, 'Cases count must be >= 200');
  assert.ok(lib.blacklist.length >= 5, 'Blacklist entries must be >= 5');
});

test('R-08 检测工整二分、虚假对称及刑律套话', () => {
  const sample = policy.scanUniversalCorrectionRisks('若账错一次，扣三月俸禄；若被定作私吞灵气，轻则废去修为，重则打入死牢。');
  assert.ok(sample.matchedRuleIds.includes('R-08-formulaic-reasoning'));
});
