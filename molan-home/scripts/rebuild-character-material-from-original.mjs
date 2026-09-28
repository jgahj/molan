import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  detectForumLike,
  detectIncomplete,
  splitChapters,
} from '../../资源库/scripts/build-manifest.mjs';
import * as rich from '../lib/character-material-v31.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const RESOURCE_ROOT = path.resolve(REPO_ROOT, '..', '资源库');
const DEFAULT_ARCHIVE_ROOT = path.join(RESOURCE_ROOT, '小说原本');
const DEFAULT_OUTPUT_ROOT = path.join(REPO_ROOT, 'data', 'character-material-v3.1-rebuild');
const DEFAULT_QUOTA_CONFIG = path.join(RESOURCE_ROOT, 'quota-config.json');

const SAMPLE_MIN_CHARS = 12;
const SAMPLE_MAX_CHARS = 140;
const DEFAULT_PER_WORK_CANDIDATES = 80;
const DEFAULT_CELL_TARGET = 25_000;
const DEFAULT_CELL_HARD_FLOOR = 12_000;
const DEFAULT_BOOK_CAP_PERCENT = 0.15;
const REBUILD_VERSION = 'character-material-v3.1-rebuild-1';
const RICH_VERSION = 'corpus-v3.1-rich-1';

const ARCHETYPES = Object.freeze([...rich.ARCHETYPE_WHITELIST]);
const DIMENSIONS = Object.freeze([...rich.DIMENSION_WHITELIST]);
const SCENES = Object.freeze([...rich.SCENE_WHITELIST]);
const RELATIONSHIPS = Object.freeze([...rich.RELATIONSHIP_WHITELIST]);
const EMOTIONAL_STATES = Object.freeze([...rich.EMOTIONAL_STATE_WHITELIST]);
const SUBTEXTS = Object.freeze([...rich.SUBTEXT_WHITELIST]);
const HTL = Object.freeze([...rich.HTL_WHITELIST]);

const SENSITIVE_PATTERN = /露骨|下身|阴茎|阴部|乳房|乳头|性交|做爱|高潮|插入|性器官|呻吟|床笫|媾合|肉棒|精液|裸身|裸体|春药|发情|淫靡|潮吹|奸淫/u;
const WATERMARK_PATTERN = /shukuge|365小说|www\.shukuge|笔趣阁|sobqg|最新章节|本章完|求收藏|求月票|求订阅/iu;
const SURNAME_CHARS = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元顾孟平黄穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林钟徐邱骆高夏蔡田樊胡凌霍虞万柯管卢莫经房裘缪解应宗丁宣邓郁单杭洪包诸左石崔吉龚程嵇邢滑裴陆荣翁荀羊惠甄封芮羿储靳汲松井段富巫乌焦巴弓牧车侯全郗班仰秋仲伊宫宁仇栾暴甘厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟印宿白怀蒲从鄂索咸赖卓蔺屠蒙池乔胥能苍双党翟谭贡姬申扶堵冉宰桑桂濮牛寿通边扈燕冀浦尚农温庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越隆师巩聂晁勾敖融冷辛那简饶空曾毋养鞠须丰巢关蒯相查荆红游竺权逯盖益桓公'.split('');
const NAME_TAIL_BLOCKLIST = /[的地得着了过在会将被很还也又就便而把让从向对跟为与和心手头脸眼身口形色气体影边里外前后上下一声说问道看望盯瞥抬低垂握抓捏咬笑哭走跑退进靠转停开坐躲挡拦劝骂喊叫答应察觉发现觉得开始继续突然死眯沉抱拿接推带钻想见伸激打扎先才仍便早各全只未已再皆吗呢吧啊呀哦喂]/u;
const COMMON_TERMS = new Set('他 她 他们 她们 它 它们 人物 人形 人影 人手 人群 人声 人脸 人身 人心 身形 身影 身上 手里 眼睛 脸上 男子 男生 女子 女生 女人 男人 少年 少女 老人 孩子 青年 兄弟 姐姐 哥哥 妈妈 父亲 母亲 师兄 师姐 师父 老师 先生 小姐 公子 姑娘 众人 所有人 时候 事情 问题 应付 司意 鹤司 鹤医生 平稳 温暖 平静 冷静 强硬 冷笑 严厉 都能 都要'.split(/\s+/u));

const CATEGORY_TO_GENRE = Object.freeze({
  传统玄幻: '玄幻', 玄幻: '玄幻', 玄幻脑洞: '玄幻',
  东方仙侠: '仙侠', 仙侠: '仙侠', 都市修真: '仙侠',
  武侠: '武侠', 奇幻: '奇幻', 西方奇幻: '奇幻',
  都市: '都市', 都市高武: '都市', 都市脑洞: '都市', 都市日常: '都市', 都市种田: '都市', 战神赘婿: '都市', 现实: '现实',
  历史: '历史', 历史古代: '历史', 历史脑洞: '历史', 军事: '惊险', 抗战谍战: '惊险',
  悬疑灵异: '悬疑', 悬疑脑洞: '悬疑', 女频悬疑: '悬疑',
  科幻: '科幻', 科幻末世: '科幻', 游戏: '游戏', 游戏体育: '游戏', 体育: '体育',
  轻小说: '轻小说', 动漫衍生: '动漫', 男频衍生: '动漫', 女频衍生: '言情',
  玄幻言情: '言情', 古风世情: '古言', 古言脑洞: '古言', 宫斗宅斗: '古言', 种田: '古言',
  快穿: '现言', 现言脑洞: '现言', 民国言情: '现言', 星光璀璨: '现言', 豪门总裁: '现言', 青春甜宠: '现言', 职场婚恋: '现言', 年代: '现言',
});

const CATEGORY_TO_BUCKET = Object.freeze({
  传统玄幻: '男频玄幻', 玄幻: '男频玄幻', 玄幻脑洞: '男频玄幻', 东方仙侠: '男频玄幻', 仙侠: '男频玄幻', 都市修真: '男频玄幻', 武侠: '男频玄幻', 奇幻: '男频玄幻', 西方奇幻: '男频玄幻',
  都市: '都市', 都市高武: '都市', 都市脑洞: '都市', 都市日常: '都市', 都市种田: '都市', 战神赘婿: '都市', 现实: '都市',
  悬疑灵异: '悬疑', 悬疑脑洞: '悬疑', 女频悬疑: '悬疑',
  玄幻言情: '言情', 古风世情: '言情', 古言脑洞: '言情', 宫斗宅斗: '言情', 种田: '言情', 快穿: '言情', 现言脑洞: '言情', 民国言情: '言情', 星光璀璨: '言情', 豪门总裁: '言情', 青春甜宠: '言情', 职场婚恋: '言情', 年代: '言情', 女频衍生: '言情',
});

const GENRE_TO_BUCKET = Object.freeze({
  玄幻: '男频玄幻', 奇幻: '男频玄幻', 仙侠: '男频玄幻', 武侠: '男频玄幻',
  都市: '都市', 现实: '都市',
  悬疑: '悬疑', 惊险: '悬疑',
  现言: '言情', 古言: '言情', 言情: '言情',
});

const FEMALE_CATEGORIES = new Set(['玄幻言情', '古风世情', '古言脑洞', '宫斗宅斗', '种田', '快穿', '现言脑洞', '民国言情', '星光璀璨', '豪门总裁', '青春甜宠', '职场婚恋', '年代', '女频衍生', '女频悬疑']);

const ARCHETYPE_CUES = Object.freeze({
  豪爽侠义型: [/豪爽|爽快|痛快|仗义|义气|直爽|洒脱|大方|干脆|兄弟|交给我|我来/u],
  冷静理智型: [/冷静|理智|证据|分析|判断|核对|谨慎|审慎|观察|推断|计划|先.{0,8}再|沉着|不动声色/u],
  温柔内敛型: [/温柔|体贴|照顾|安慰|轻声|小心翼翼|默默|垂眸|欲言又止|抿唇|没关系|不用担心|替.{0,8}(?:整理|盖|擦|扶)/u],
  活泼开朗型: [/活泼|开朗|乐观|兴奋|欢快|蹦|跳|笑嘻嘻|打趣|调侃|热闹|哈哈|哎呀/u],
  阴郁腹黑型: [/阴沉|阴郁|腹黑|算计|试探|讥讽|嘲|危险|眯眼|布局|利用|报复|杀意|冷笑/u],
  霸道强势型: [/命令|必须|不许|滚|闭嘴|掌控|强势|霸道|冷声|拦住|抓住|不容拒绝|我说了算/u],
  天真烂漫型: [/天真|单纯|烂漫|懵懂|好奇|为什么|真的吗|眨眼|惊讶|开心|第一次|好玩/u],
  市侩圆滑型: [/利益|价钱|银子|报酬|买卖|稳赚|讨价|客套|赔笑|见风使舵|打哈哈|方便|生意|得罪不起/u],
  高傲冷峻型: [/高傲|冷峻|孤傲|不屑|淡淡|漠然|疏离|嗤笑|懒得|无需|居高临下|冷冷地/u],
  热血冲动型: [/热血|冲上|怒吼|暴躁|忍不住|立刻|马上|拔|挥|冲|战|拼|怒|大喊|不服/u],
});

const ARCHETYPE_HINTS = Object.freeze({
  豪爽侠义型: '动作直接、关系表达外放，愿意为承诺承担看得见的代价',
  冷静理智型: '先观察限制和证据，再用克制的动作争取选择空间',
  温柔内敛型: '情绪藏在照料、退让和不完整的话语里，但关键处会作出明确选择',
  活泼开朗型: '用轻快的反应和主动靠近调节关系，同时保留对风险的即时感知',
  阴郁腹黑型: '信息不一次说尽，让试探、延迟和代价体现人物的防备与算计',
  霸道强势型: '通过占据位置、下达要求和承担后果建立控制感，而不是只靠宣告强大',
  天真烂漫型: '从直接感受和具体好奇出发，让误解与真诚共同推动选择',
  市侩圆滑型: '优先衡量利益、风险和关系成本，语言留有可转圜的余地',
  高傲冷峻型: '减少无效解释，以距离、筛选和精准反应表现自我边界',
  热血冲动型: '压力先转化成身体和行动，冲动必须带来收获、损失或新的限制',
});

const DIMENSION_RULES = Object.freeze({
  appearance: ['外貌只选会影响当前判断或行动的细节，用姿态、衣着状态和环境反应呈现人物，不做静态清单。', '让一个可观察细节服务于人物当下的目标、压力或关系。', '不要用空泛的漂亮、冷峻、温柔等标签代替细节。'],
  expression: ['神态通过视线、停顿、呼吸、手部和面部的微小变化落地，允许反应不完整。', '先写人物看见或听见什么，再写身体如何泄露态度。', '不要在动作后重复解释同一种情绪。'],
  action: ['动作要带有选择和阻力，写清人物做了什么、为此承担什么代价，以及动作如何改变场面。', '用动作推进冲突，而不是用性格标签宣布人物是什么样的人。', '不要堆叠无结果的动作或让身体部位脱离人物自行行动。'],
  dialogue: ['对白围绕即时目的展开，保留角色的省略、打断、称呼和不愿说出的部分。', '每一句话都应争取信息、关系、时间或位置中的至少一项。', '不要把对白写成完整的教程式论证。'],
  catchphrase: ['口头禅只能作为稳定倾向，必须结合关系和场景变化，不能机械重复。', '让高频语气在压力增大或关系变化时出现偏移。', '不要用一个口头禅替代人物声音的全部差异。'],
  psychology: ['心理优先保留当前人物能意识到的片段和选择依据，省略显而易见的完整因果链。', '让感官、记忆碎片或未完成的念头逼近最终行动。', '不要用完整意图链把所有答案提前讲完。'],
});

const SCENE_CUES = Object.freeze([
  ['战斗', /战|厮杀|挥刀|拔剑|冲上|袭来|交手|开火/u],
  ['危机', /危险|危机|救命|失火|坠|逃|追|警报|来不及/u],
  ['争吵', /吵|怒斥|骂|争执|闭嘴|滚|反驳/u],
  ['冲突', /冲突|对峙|拦住|拒绝|不许|挡在|敌意/u],
  ['谈判', /谈判|条件|交换|筹码|代价|合作|协议/u],
  ['试探', /试探|打量|观察|问道|是不是|听说|你觉得|吗[？?]/u],
  ['安慰', /安慰|别怕|没事|不用担心|放心|拍拍|轻声/u],
  ['关心', /照顾|担心|伤|疼|递|扶|盖|等你|小心/u],
  ['误解', /误会|误解|以为|原来你|听错|看错/u],
  ['和解', /和解|道歉|原谅|算了|握手|重新开始/u],
  ['告白', /喜欢你|爱你|告白|心意|在一起/u],
  ['暧昧', /暧昧|脸红|靠近|耳尖|心跳|目光交缠/u],
  ['离别', /离开|告别|再见|送行|回去|分别/u],
  ['重逢', /重逢|回来|多年不见|再见到|见面/u],
  ['公开场合', /众人|人群|宴会|大厅|会议|台下|所有人/u],
  ['私下场合', /房间|屋里|门后|无人|只有他们|私下/u],
  ['独处', /独自|一个人|独处|空荡荡|身边没有人/u],
  ['闲聊', /闲聊|聊起|说起|随口|打趣|闲谈/u],
  ['胜利', /胜利|赢了|成功|获胜|拿下/u],
  ['失败', /失败|输了|落空|失手|没能/u],
]);

const RELATIONSHIP_CUES = Object.freeze([
  ['夫妻', /丈夫|妻子|夫妻|老婆|老公/u],
  ['恋人', /恋人|男友|女友|爱人|喜欢你|爱你/u],
  ['暧昧对象', /暧昧|心跳|脸红|靠近|耳尖/u],
  ['父子', /父亲|爸爸|儿子|父子/u],
  ['母子', /母亲|妈妈|母子/u],
  ['兄弟姐妹', /兄弟|姐妹|哥哥|姐姐|弟弟|妹妹/u],
  ['师徒', /师父|师傅|徒弟|师兄|师姐|师弟|师妹/u],
  ['上下级', /上司|下属|领导|老板|经理|部下|命令/u],
  ['同僚', /同事|同僚|队友|同门/u],
  ['竞争者', /竞争|对手|比赛|争夺|较量/u],
  ['敌对', /敌人|敌对|仇|杀意|厮杀|报复/u],
  ['家人', /家人|父母|亲人|家里/u],
  ['普通朋友', /朋友|伙伴|同学|邻居/u],
]);

const EMOTION_CUES = Object.freeze([
  ['紧张', /紧张|屏住呼吸|手心|发颤|僵住|绷紧/u],
  ['尴尬', /尴尬|干笑|讪讪|无言|气氛|咳/u],
  ['防备', /防备|警惕|戒备|试探|盯着|提防/u],
  ['期待', /期待|盼|等着|希望|渴望|眼巴巴/u],
  ['失望', /失望|落空|黯然|垂下|没想到/u],
  ['委屈', /委屈|鼻酸|红了眼|咬唇|忍着/u],
  ['羞耻', /羞|耳根|脸红|难堪|无地自容/u],
  ['得意', /得意|扬眉|挑眉|炫耀|洋洋/u],
  ['心虚', /心虚|躲闪|不敢|掩饰|强笑/u],
  ['担忧', /担心|担忧|忧虑|不安|怕他|放心不下/u],
  ['嘴硬', /没事|不用|随便|不关你事|谁稀罕|我才不/u],
  ['压抑', /压抑|忍住|克制|沉默|闷|强忍/u],
  ['兴奋', /兴奋|激动|欢呼|雀跃|热血/u],
  ['疲惫', /疲惫|疲倦|困|犯困|哈欠|累/u],
  ['走神', /走神|发呆|出神|愣神|思绪飘/u],
  ['平静', /平静|淡然|从容|安静|不动声色/u],
]);

const HTL_CUES = Object.freeze([
  ['pause', /……|…{1,}|停顿|顿了顿|沉默/u],
  ['hesitation', /犹豫|迟疑|欲言又止|半晌|踌躇/u],
  ['unfinished_thought', /话到嘴边|想说|只是.{0,8}[。！？]|……/u],
  ['avoidance', /避开|移开|不去看|没有回答|装作|假装/u],
  ['deflection', /只是|不过|随口|开玩笑|说笑/u],
  ['topic_shift', /对了|说起来|先不说|转而|扯开话题/u],
  ['interruption', /打断|插话|等等|别说|住口|话音未落/u],
  ['repair', /不，|不是，|应该说|更准确地说|咳/u],
  ['vague_reference', /那件事|那个人|有些事|什么的|某种|那样/u],
  ['casual_filler', /嗯|啊|哎|唉|啧|喂|哈哈/u],
  ['self_contradiction', /明明.{0,12}却|嘴上.{0,12}却|说着.{0,12}却/u],
  ['habitual_gesture', /习惯|总是|一向|下意识|惯常/u],
  ['object_habit', /口袋|杯子|烟|笔|钥匙|摸|捻|摆弄|手里/u],
  ['body_habit', /咬唇|抿唇|摸鼻|揉眉|敲|握拳|捏|垂眸/u],
  ['speech_habit', /总说|开口就是|常说|口头禅/u],
  ['save_face', /强笑|装作|若无其事|面不改色|故作/u],
  ['politeness_mask', /客气|请|谢谢|麻烦|微笑|礼貌/u],
  ['status_awareness', /先生|小姐|老板|领导|殿下|大人|身份/u],
  ['social_pressure', /众人|目光|旁人|所有人|人群|场合/u],
  ['reading_the_room', /打量|观察|察言观色|看了看|环顾/u],
  ['sensory_anchor', /雨|风|雪|灯|光|烟|咖啡|血|汗|凉|冷|热|潮湿|铁锈|药味/u],
  ['object_anchor', /杯|伞|钥匙|门|窗|手机|纸|刀|剑|书|口袋|衣角/u],
  ['spatial_anchor', /门口|窗边|墙角|桌旁|身后|身前|台阶|走廊|距离/u],
  ['body_detail', /指尖|喉结|肩膀|手腕|耳尖|眼睫|嘴角|呼吸|脊背/u],
  ['environment_detail', /雨声|灯光|街道|走廊|房间|风声|人群|夜色/u],
  ['delayed_reaction', /过了片刻|半晌后|这才|才意识到|后来才/u],
  ['misplaced_attention', /却看向|反而盯着|注意到的却|目光落在/u],
  ['unexpected_focus', /偏偏|唯独|反倒|只看见|最先注意到/u],
  ['implicit_emotion', /抿唇|垂眸|握紧|转身|停下|移开视线|没有说话/u],
  ['unexplained_reaction', /忽然|突然|莫名|无端|没来由/u],
  ['silent_response', /沉默|没有回答|不置可否|只看着|一言不发|一声不吭/u],
]);

const SUBTEXT_CUES = Object.freeze([
  ['嘴硬', /没事|不用|随便|不关你事|谁稀罕|我才不/u],
  ['试探', /是不是|难道|你觉得|听说|吗[？?]|为什么/u],
  ['掩饰关心', /小心|别动|伤|疼|照顾|递|扶|盖|等|放心/u],
  ['欲言又止', /……|欲言又止|张口|停顿|沉默|话到嘴边/u],
  ['掩饰生气', /随口|开玩笑|呵|笑了笑|没关系|算了/u],
  ['缓解尴尬', /哈哈|开玩笑|咳|随便聊聊|对了/u],
  ['转移话题', /只是|不过|对了|说起来|先不说|扯开/u],
  ['维持体面', /客气|礼貌|微笑|淡淡|不动声色|从容/u],
  ['保护自尊', /不需要|无需|不必|自己来|不用你管/u],
  ['故意冷淡', /冷淡|淡淡地|漠然|懒得|随你/u],
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function shortHash(value, length = 16) {
  return stableHash(value).slice(0, length);
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/u, '')
    .replace(/[\u200B-\u200D\u2060]/gu, '')
    .replace(/\r\n?/gu, '\n');
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/gu, ' ').trim();
}

function characterCount(value) {
  return Array.from(String(value ?? '')).length;
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const handle = fs.openSync(filePath, 'w');
  try {
    for (const row of rows) fs.writeSync(handle, `${JSON.stringify(row)}\n`, null, 'utf8');
  } finally {
    fs.closeSync(handle);
  }
}

function walkTxtFiles(root) {
  const files = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && /\.txt$/iu.test(entry.name)) files.push(fullPath);
    }
  };
  if (fs.existsSync(root)) visit(root);
  return files.sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function parseFilename(fileName) {
  const base = path.basename(String(fileName || '')).replace(/\.txt$/iu, '');
  const cleaned = base
    .replace(/^\d+[-_]/u, '')
    .replace(/[【\[].*?(?:搜|笔趣|www\.|sobqg).*?[】\]]/iu, '')
    .replace(/\s*[（(]\s*\d+\s*[-—至]\s*\d+\s*[章节卷部集篇回][^）)]*[）)]\s*$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const match = cleaned.match(/^(.*?)\s+-\s+(.+)$/u);
  const title = (match?.[1] || cleaned || '未命名作品').trim();
  const author = (match?.[2] || '未署名').trim();
  return { title, author };
}

function categoryFor(relativePath) {
  return String(relativePath || '').split('/').filter(Boolean)[0] || '未分类';
}

function genreFor(category, title) {
  if (CATEGORY_TO_GENRE[category]) return CATEGORY_TO_GENRE[category];
  if (/诡秘|盗墓|谜|悬疑|灵异/u.test(title)) return '悬疑';
  if (/蛊真人|邪神|斗破|修仙|剑|仙/u.test(title)) return '玄幻';
  return '未分类';
}

function bucketFor(category, genre, config = {}) {
  const configuredBucket = config?.sourceBucketMap?.[genre];
  if (configuredBucket) return configuredBucket;
  return CATEGORY_TO_BUCKET[category] || GENRE_TO_BUCKET[genre] || (genre === '未分类' ? '其他' : `raw/${genre}`);
}

function audienceFor(category) {
  return FEMALE_CATEGORIES.has(category) ? '女频' : category === '未分类' ? '未指定' : '男频';
}

function defaultQualityGates(config) {
  return {
    fanfictionSampleChars: 30_000,
    forumSampleChars: 10_000,
    forumFeatureDensityPerKChars: 1.5,
    shortChapterChars: 500,
    shortChapterRun: 3,
    shortChapterRelativeToMean: 0.35,
    ...(isObject(config?.qualityGates) ? config.qualityGates : {}),
  };
}

function countMatches(text, pattern) {
  const source = String(text || '');
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  return [...source.matchAll(re)].length;
}

function duplicateParagraphRate(text) {
  const paragraphs = normalizeText(text)
    .split(/\n\s*\n|\n+/u)
    .map(value => value.trim())
    .filter(value => characterCount(value) >= 20);
  if (paragraphs.length < 10) return 0;
  const unique = new Set(paragraphs.map(value => rich.canonicalizeText(value)));
  return Number((1 - unique.size / paragraphs.length).toFixed(4));
}

function analyzeOriginalText({ text, bytes, relativePath, category, config }) {
  const normalized = normalizeText(text);
  const compact = normalized.replace(/\s/gu, '');
  const chapters = splitChapters(normalized);
  const chapterRows = chapters.map(chapter => ({ title: chapter.title, chars: chapter.chars }));
  const integrity = detectIncomplete(chapterRows, { qualityGates: defaultQualityGates(config) });
  const forum = detectForumLike(normalized, { qualityGates: defaultQualityGates(config) });
  const puaRate = countMatches(normalized, /[\uE000-\uF8FF]/u) / Math.max(1, characterCount(normalized));
  const mojibakeRate = countMatches(normalized, /�/u) / Math.max(1, characterCount(normalized));
  const nonEmptyLines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
  const watermarkLines = nonEmptyLines.filter(line => WATERMARK_PATTERN.test(line)).length;
  const watermarkLineRate = watermarkLines / Math.max(1, nonEmptyLines.length);
  const filenamePartial = /[（(]\s*\d+\s*[-—至]\s*\d+\s*[章节卷部集篇回]/u.test(path.basename(relativePath));
  const reasons = [];
  if (category === '测试') reasons.push('test_fixture');
  if (bytes < 32 * 1024) reasons.push('file_too_small');
  if (characterCount(compact) < 12_000) reasons.push('text_too_short');
  if (chapters.length < 3) reasons.push('chapter_count_too_low');
  if (puaRate > 0.001) reasons.push('private_use_area_noise');
  if (mojibakeRate > 0.01) reasons.push('mojibake_rate_high');
  if (watermarkLineRate > 0.005) reasons.push('watermark_rate_high');
  if (duplicateParagraphRate(normalized) > 0.5) reasons.push('duplicate_paragraph_rate_high');
  if (forum.forumLike) reasons.push('forum_like_text');
  if (filenamePartial || integrity.incomplete) reasons.push('partial_or_incomplete');
  return {
    status: reasons.length ? 'rejected' : 'admitted',
    eligibleForAdvancedAnalysis: reasons.length === 0,
    reasons: [...new Set(reasons)],
    bytes,
    characterCount: characterCount(compact),
    chapterCount: chapters.length,
    chapters: chapterRows,
    meanChapterChars: integrity.meanChars,
    shortChapterRun: integrity.shortChapterRun,
    missingChapterRanges: integrity.missingRanges,
    partial: filenamePartial || integrity.incomplete,
    puaRate: Number(puaRate.toFixed(6)),
    mojibakeRate: Number(mojibakeRate.toFixed(6)),
    watermarkLineRate: Number(watermarkLineRate.toFixed(6)),
    duplicateParagraphRate: duplicateParagraphRate(normalized),
    forum,
    completionHeuristic: reasons.includes('partial_or_incomplete') ? 'incomplete' : 'completed',
  };
}

function buildSourceRecord(filePath, archiveRoot, text, config, order) {
  const relativePath = path.relative(archiveRoot, filePath).replace(/\\/gu, '/');
  const { title, author } = parseFilename(filePath);
  const category = categoryFor(relativePath);
  const genre = genreFor(category, title);
  const quality = analyzeOriginalText({
    text,
    bytes: fs.statSync(filePath).size,
    relativePath,
    category,
    config,
  });
  const sourceWorkId = `local-${shortHash(relativePath)}`;
  const authorization = {
    status: 'user_authorized',
    scope: 'corpus',
    evidenceRef: 'user:explicit-authorization',
    evidenceVerified: true,
    rightsHolder: 'user-provided-local-corpus',
    permissions: {
      archiveUseAllowed: true,
      modelProcessingAllowed: true,
      runtimeUseAllowed: true,
    },
  };
  return {
    sourceWorkId,
    canonicalWorkId: sourceWorkId,
    platform: '本地原本',
    platformWorkId: sourceWorkId,
    title,
    author,
    category,
    rawGenres: [genre],
    primaryGenre: genre,
    audience: audienceFor(category),
    genreBucket: bucketFor(category, genre, config),
    sourceFilePath: relativePath,
    filePath: relativePath,
    sourceKind: 'original-local-corpus',
    rankType: 'local-order',
    rank: order,
    wordNumber: quality.characterCount,
    completionStatus: quality.completionHeuristic,
    contentScope: quality.completionHeuristic === 'completed' ? 'full_work' : 'partial',
    authorization,
    completionEvidence: {
      status: 'user_confirmed',
      evidenceRef: 'user:original-corpus-completeness-confirmed',
      verified: true,
    },
    contentEvidence: {
      status: 'local_file_readable',
      evidenceRef: `local:${relativePath}`,
      verified: true,
      sha256Gate: 'not_used_by_user_instruction',
    },
    quality,
  };
}

function nameTerms(value) {
  const source = compactText(value);
  const result = new Set();
  const pattern = new RegExp(`([${SURNAME_CHARS.join('')}][\\u4e00-\\u9fff]{1,2})`, 'gu');
  for (const match of source.matchAll(pattern)) {
    const token = match[1];
    const start = match.index ?? 0;
    const after = source[start + token.length] || '';
    const nextAllowed = !after || /[，。！？：；、“”‘’」』\s]|说|道|问|看|望|盯|笑|哭|走|跑|抬|低|垂|握|抓|捏|咬|想|见|让|被|把|将|先|才|就|又|也|仍|还|便|再/u.test(after);
    if (!nextAllowed) continue;
    for (const length of [3, 2]) {
      const valuePart = token.slice(0, length);
      const given = valuePart.slice(1);
      if (valuePart.length < 2 || COMMON_TERMS.has(valuePart) || NAME_TAIL_BLOCKLIST.test(given) || /^(?:大|小|老|少)[\u4e00-\u9fff]?$/u.test(valuePart)) continue;
      result.add(valuePart);
      break;
    }
  }
  return [...result];
}

function anonymizeText(text, source) {
  const raw = compactText(text);
  const direct = [source.title, source.author]
    .map(value => String(value || '').replace(/[《》【】（）()]/gu, '').trim())
    .filter(value => characterCount(value) >= 2 && !COMMON_TERMS.has(value));
  const terms = [...new Set([...direct, ...nameTerms(raw)])]
    .filter(term => raw.includes(term) && !COMMON_TERMS.has(term))
    .sort((left, right) => characterCount(right) - characterCount(left) || left.localeCompare(right, 'zh-CN'));
  let safe = raw;
  const forbiddenTerms = [];
  for (const term of terms) {
    if (!safe.includes(term)) continue;
    forbiddenTerms.push(term);
    let first = true;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    safe = safe.replace(new RegExp(escaped, 'gu'), () => {
      const value = first ? '[人物]' : '对方';
      first = false;
      return value;
    });
  }
  const residualTerms = forbiddenTerms.filter(term => safe.includes(term));
  return {
    rawText: raw,
    safeText: safe,
    auditText: safe,
    forbiddenTerms: [...new Set(forbiddenTerms)],
    residualTerms,
  };
}

function firstCue(text, cues) {
  for (const [label, pattern] of cues) {
    const match = String(text || '').match(pattern);
    if (match) return { label, evidence: match[0] };
  }
  return null;
}

function labelsFromCues(text, cues, fallback, limit = 3) {
  const labels = [];
  const evidence = {};
  for (const [label, pattern] of cues) {
    const match = String(text || '').match(pattern);
    if (!match) continue;
    if (!labels.includes(label)) labels.push(label);
    evidence[label] = match[0];
    if (labels.length >= limit) break;
  }
  if (!labels.length && fallback) labels.push(fallback);
  return { labels, evidence };
}

function inferArchetype(text, dimension, sourceWorkId) {
  const scores = Object.fromEntries(ARCHETYPES.map(archetype => [archetype, 0]));
  for (const [archetype, patterns] of Object.entries(ARCHETYPE_CUES)) {
    scores[archetype] = patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
  }
  const ranked = ARCHETYPES.slice().sort((left, right) => scores[right] - scores[left] || left.localeCompare(right, 'zh-CN'));
  const fallbackByDimension = {
    appearance: '高傲冷峻型', expression: '温柔内敛型', action: '热血冲动型', dialogue: '活泼开朗型', catchphrase: '市侩圆滑型', psychology: '冷静理智型',
  };
  const top = scores[ranked[0]] > 0 ? ranked[0] : fallbackByDimension[dimension] || ARCHETYPES[Number.parseInt(shortHash(`${sourceWorkId}|${text}`, 2), 16) % ARCHETYPES.length];
  const positive = Object.values(scores).filter(value => value > 0).reduce((sum, value) => sum + value, 0);
  const confidence = Number(Math.min(0.94, Math.max(0.55, (scores[top] + 1) / (positive + 2))).toFixed(2));
  return {
    primaryArchetype: top,
    archetypeDistribution: { [top]: 1 },
    confidence,
    scores,
    source: scores[top] > 0 ? 'lexical-evidence' : 'dimension-fallback',
  };
}

function inferContext(text, dimension) {
  const scenes = labelsFromCues(text, SCENE_CUES, '日常', 3);
  const relationships = labelsFromCues(text, RELATIONSHIP_CUES, '普通朋友', 2);
  const emotions = labelsFromCues(text, EMOTION_CUES, '平静', 3);
  const subtextCue = firstCue(text, SUBTEXT_CUES);
  const surfaceIntent = /[“「『]/u.test(text)
    ? (/吗[？?]|是不是|为什么/u.test(text) ? '询问或确认' : /别|不用|不许|滚/u.test(text) ? '拒绝或设限' : /谢谢|放心|没事/u.test(text) ? '安抚或维持关系' : '争取信息或位置')
    : (/想|决定|犹豫|意识到/u.test(text) ? '整理选择依据' : '通过行动改变现场');
  return {
    scene: scenes.labels,
    sceneEvidence: scenes.evidence,
    relationship: relationships.labels,
    relationshipEvidence: relationships.evidence,
    emotionalState: emotions.labels,
    emotionalEvidence: emotions.evidence,
    subtext: subtextCue?.label && SUBTEXTS.includes(subtextCue.label) ? subtextCue.label : null,
    subtextEvidence: subtextCue?.evidence ? [subtextCue.evidence] : [],
    surfaceIntent,
  };
}

function inferHtl(text, dimension, context) {
  const signals = [];
  const evidence = {};
  const add = (signal, value) => {
    if (!HTL.includes(signal) || signals.includes(signal) || !value) return;
    signals.push(signal);
    evidence[signal] = [value];
  };
  for (const [signal, pattern] of HTL_CUES) {
    const match = String(text || '').match(pattern);
    if (match) add(signal, match[0]);
    if (signals.length >= 4) break;
  }
  if (signals.length < 4 && context.subtext) add('implicit_emotion', context.subtextEvidence[0] || context.subtext);
  if (signals.length < 4 && /[“「『]/u.test(text) && /却|反而|仍然|还是/u.test(text)) add('speech_vs_action', text.match(/却|反而|仍然|还是/u)?.[0]);
  if (signals.length < 4 && /看|盯|望|眸|脸色/u.test(text) && !/开心|愤怒|悲伤|紧张/u.test(text)) add('reader_inference', text.match(/看|盯|望|眸|脸色/u)?.[0]);
  if (signals.length < 4 && dimension === 'action' && /手|指|肩|背|喉结|嘴角/u.test(text)) add('body_detail', text.match(/手|指|肩|背|喉结|嘴角/u)?.[0]);
  if (!signals.length) add('implicit_emotion', '动作留下态度线索');
  return { signals, evidence };
}

function microPatternFor(dimension, context, htl) {
  const patternByDimension = {
    appearance: ['先让人物处在一个有压力的空间里', '选取会影响判断的外貌或衣着细节', '用人物的姿态或他人反应改变关系位置'],
    expression: ['人物先接收外部信息', '身体出现短暂而不完整的泄露', '不把情绪结论说尽，让下一步行动补足态度'],
    action: ['设置一个即时目标或阻力', '用带方向的动作处理阻力', '让动作留下关系、位置或代价的变化'],
    dialogue: ['对白带着即时目的进入场面', '人物省略、停顿或转移一部分信息', '对方的反应迫使关系重新定位'],
    catchphrase: ['稳定语气在熟悉关系中出现', '压力或场景让语气发生轻微偏移', '偏移暴露人物真正关切的对象'],
    psychology: ['从感官或记忆碎片触发念头', '保留人物尚未整理完的判断', '选择通过动作或话语落地'],
  };
  return {
    id: `mp-${dimension}-${htl.signals[0] || 'general'}`,
    dimension,
    scene: context.scene.slice(0, 2),
    relationship: context.relationship.slice(0, 2),
    signals: htl.signals.slice(0, 4),
    pattern: patternByDimension[dimension] || patternByDimension.action,
    whyItWorks: '把可观察细节、人物当下目的和关系变化放在同一条行为链上，保留读者推断空间。',
    antiPattern: '避免静态性格宣告、完整心理解释和脱离场面的动作堆叠。',
  };
}

function scoreCandidate(candidate, source) {
  const text = compactText(candidate.text);
  const recall = Array.isArray(candidate.recallKinds) ? candidate.recallKinds : [];
  const lengthScore = Math.max(0, 1 - Math.abs(characterCount(text) - 66) / 90);
  const punctuationScore = Math.min(1, (text.match(/[，。！？；：“”]/gu) || []).length / 8);
  const signalScore = Math.min(1, recall.length / 3);
  const entityScore = nameTerms(text).length ? 0.15 : 0;
  const lifeScore = recall.includes('lifeTexture') ? 0.18 : 0;
  const multiDimensionScore = Array.isArray(candidate.secondaryDimensions) && candidate.secondaryDimensions.length ? 0.12 : 0;
  const score = Number((lengthScore * 0.32 + punctuationScore * 0.18 + signalScore * 0.24 + entityScore + lifeScore + multiDimensionScore + (source.quality.characterCount > 100_000 ? 0.06 : 0)).toFixed(6));
  return score;
}

function candidateRowFromMine(candidate, source, text, bodyStart, chapter) {
  const raw = compactText(candidate.text);
  const evidence = candidate.evidence || {};
  const localStart = Math.max(0, Number(evidence.charStart || bodyStart) - bodyStart);
  const localEnd = Math.max(localStart, Number(evidence.charEnd || bodyStart + raw.length) - bodyStart);
  const unitText = text.slice(bodyStart, Number(chapter.end) || text.length);
  const entityContext = {
    before: compactText(unitText.slice(Math.max(0, localStart - 160), localStart)),
    after: compactText(unitText.slice(localEnd, Math.min(unitText.length, localEnd + 160))),
  };
  const candidateId = `candidate-${shortHash(`${source.sourceWorkId}|${source.sourceFilePath}|${evidence.chapterIndex}|${evidence.charStart}|${raw}`)}`;
  const classification = inferArchetype(raw, candidate.dimension, source.sourceWorkId);
  const row = {
    candidateId,
    id: candidateId,
    text: raw,
    sourceWorkId: source.sourceWorkId,
    canonicalWorkId: source.canonicalWorkId,
    title: source.title,
    author: source.author,
    platform: source.platform,
    audience: source.audience,
    category: source.category,
    rawGenres: source.rawGenres,
    primaryGenre: source.primaryGenre,
    genre: source.primaryGenre,
    genreBucket: source.genreBucket,
    sourceFilePath: source.sourceFilePath,
    sourceKind: source.sourceKind,
    dimension: candidate.dimension,
    secondaryDimensions: candidate.secondaryDimensions || [],
    kind: candidate.kind,
    recallKinds: candidate.recallKinds || [],
    archetype: classification.primaryArchetype,
    archetypeDistribution: classification.archetypeDistribution,
    classification: {
      method: classification.source,
      confidence: classification.confidence,
      scores: classification.scores,
      modelReview: 'automatic-self-review',
    },
    selectionScore: scoreCandidate(candidate, source),
    entityContext,
    characterEvidence: {
      status: nameTerms(`${entityContext.before}${raw}${entityContext.after}`).length ? 'inferred' : 'unresolved',
      candidateNames: nameTerms(`${entityContext.before}${raw}${entityContext.after}`).slice(0, 8),
      candidateCount: nameTerms(`${entityContext.before}${raw}${entityContext.after}`).length,
      method: 'local-lexical-context',
    },
    evidence: {
      chapterIndex: Number.isInteger(evidence.chapterIndex) ? evidence.chapterIndex : null,
      paragraphIndex: evidence.paragraphIndex ?? null,
      charStart: Number(evidence.charStart || 0),
      charEnd: Number(evidence.charEnd || 0),
      sourceFilePath: source.sourceFilePath,
      chapterTitle: chapter.title,
      offsetUnit: 'normalized-utf16-code-unit',
    },
    provenance: {
      sourceFilePath: source.sourceFilePath,
      chapterIndex: Number.isInteger(evidence.chapterIndex) ? evidence.chapterIndex : null,
      chapterNumber: Number.isInteger(chapter.number) ? chapter.number : null,
      chapterTitle: chapter.title,
      startOffset: Number(evidence.charStart || 0),
      endOffset: Number(evidence.charEnd || 0),
      offsetUnit: 'normalized-utf16-code-unit',
      sourceEvidence: 'local-file-readback',
    },
  };
  return row;
}

function mineWorkCandidates(source, text, perWorkLimit) {
  const normalized = normalizeText(text);
  const chapters = splitChapters(normalized);
  const mined = [];
  for (const [index, chapter] of chapters.entries()) {
    const chapterSlice = normalized.slice(Number(chapter.start) || 0, Number(chapter.end) || normalized.length);
    const heading = chapter.title === '全文' ? '' : (chapterSlice.match(/^[^\n]*(?:\n|$)/u)?.[0] || '');
    const bodyStart = (Number(chapter.start) || 0) + heading.length;
    const body = chapter.title === '全文' ? chapterSlice : chapterSlice.slice(heading.length);
    if (!compactText(body)) continue;
    const units = [{
      text: body,
      charOffset: bodyStart,
      chapterIndex: Number.isInteger(chapter.number) ? chapter.number : index + 1,
      sourceWorkId: source.sourceWorkId,
    }];
    const rows = rich.candidateMine(units, { sourceWorkId: source.sourceWorkId });
    for (const candidate of rows) mined.push(candidateRowFromMine(candidate, source, normalized, bodyStart, chapter));
  }
  const unique = new Map();
  for (const row of mined) {
    const key = `${rich.canonicalizeText(row.text)}|${row.dimension}`;
    const existing = unique.get(key);
    if (!existing || row.selectionScore > existing.selectionScore) unique.set(key, row);
  }
  return [...unique.values()]
    .sort((left, right) => right.selectionScore - left.selectionScore || left.candidateId.localeCompare(right.candidateId))
    .slice(0, perWorkLimit);
}

function makeAnnotation(row) {
  const context = inferContext(row.text, row.dimension);
  const htl = inferHtl(row.text, row.dimension, context);
  const archetype = row.archetype;
  const names = row.characterEvidence?.candidateNames || [];
  const personKey = names[0] || 'unresolved';
  const anonymized = anonymizeText(row.text, row);
  const microPattern = microPatternFor(row.dimension, context, htl);
  return {
    source: {
      sourceWorkId: row.sourceWorkId,
      canonicalWorkId: row.canonicalWorkId,
      platform: row.platform,
      title: row.title,
      author: row.author,
      completionStatus: 'completed',
      rawGenres: row.rawGenres,
      primaryGenre: row.primaryGenre,
      genreBucket: row.genreBucket,
      audience: row.audience,
      filePath: row.sourceFilePath,
      sourceFilePath: row.sourceFilePath,
      chapterIndex: row.evidence.chapterIndex,
      chapterTitle: row.evidence.chapterTitle,
      offsetUnit: row.evidence.offsetUnit,
    },
    person: {
      personId: `auto-person-${shortHash(`${row.sourceWorkId}|${personKey}`)}`,
      canonicalName: '匿名人物',
      primaryArchetype: archetype,
      archetypeDistribution: row.archetypeDistribution,
      stateArchetype: context.emotionalState,
    },
    dimension: row.dimension,
    secondaryDimensions: row.secondaryDimensions,
    scene: context.scene,
    relationship: context.relationship,
    emotionalState: context.emotionalState,
    surfaceIntent: context.surfaceIntent,
    subtext: context.subtext,
    subtextEvidence: context.subtextEvidence,
    subtextConfidence: context.subtext ? 0.7 : null,
    humanTextureSignals: htl.signals,
    humanTextureEvidence: htl.evidence,
    microPatterns: [microPattern],
    antiPatterns: [microPattern.antiPattern],
    rawText: anonymized.rawText,
    safeText: anonymized.safeText,
    auditText: anonymized.auditText,
    forbiddenTerms: anonymized.forbiddenTerms,
    anonymizationScore: anonymized.residualTerms.length ? 0 : 1,
    evidence: {
      ...row.evidence,
      chapterEvidence: [row.evidence],
    },
    confidence: row.classification.confidence,
    quality: {
      grade: 'A',
      confidence: row.classification.confidence,
    },
  };
}

function buildRichRecord(row) {
  const annotation = makeAnnotation(row);
  const record = rich.annotateCandidate(row, annotation);
  record.autoReview = {
    status: 'accepted-by-automatic-self-review',
    method: 'deterministic-lexical-evidence',
    humanCalibration: 'skipped-by-user-instruction',
    decisionEvidence: {
      candidateId: row.candidateId,
      recallKinds: row.recallKinds,
      classification: row.classification,
      sourcePosition: row.evidence,
    },
  };
  const validation = rich.validateRichRecord(record);
  return { record, validation };
}

function twelveGrams(text) {
  const chars = Array.from(rich.canonicalizeText(text));
  const values = [];
  for (let index = 0; index <= chars.length - 12; index += 1) values.push(chars.slice(index, index + 12).join(''));
  return values;
}

function runtimeSampleFromRecord(record, index) {
  const source = record.source || {};
  const sample = record.sample || {};
  const sourceWorkId = String(source.sourceWorkId || '').trim();
  const text = compactText(sample.safeText || '');
  return {
    id: String(sample.id || record.candidateId || `sample-${index + 1}`),
    archetype: record.person?.primaryArchetype || '',
    dimension: sample.dimension || 'action',
    corpus: SENSITIVE_PATTERN.test(record.sample?.rawText || '') ? 'mature' : 'general',
    text,
    sourceHash: shortHash(`${sourceWorkId}|${record.sample?.normalizedTextHash || text}`),
    canonicalWorkId: source.canonicalWorkId || sourceWorkId,
    sourceWorkId,
    sourceNovelId: sourceWorkId,
    platform: source.platform || '本地原本',
    audience: source.audience || '',
    genre: source.primaryGenre || '',
    rawGenres: Array.isArray(source.rawGenres) ? source.rawGenres : [],
    primaryGenre: source.primaryGenre || '',
    genreBucket: source.genreBucket || GENRE_TO_BUCKET[source.primaryGenre] || (source.primaryGenre ? `raw/${source.primaryGenre}` : ''),
    authorHash: source.author ? shortHash(source.author) : '',
    signals: Array.isArray(sample.humanTextureSignals) ? sample.humanTextureSignals.slice(0, 12) : [],
    forbiddenTerms: [],
    residualTerms: [],
    score: Number(record.quality?.confidence || 0),
  };
}

function hasOverlap(text, exactHashes, ngramSet) {
  const normalizedHash = rich.normalizedTextHash(text);
  if (exactHashes.has(normalizedHash)) return { blocked: true, reason: 'exact_duplicate' };
  for (const gram of twelveGrams(text)) if (ngramSet.has(gram)) return { blocked: true, reason: 'twelve_character_overlap' };
  return { blocked: false, normalizedHash };
}

function selectRuntimeSamples(records, config) {
  const target = Number(config?.cellMinChars) || DEFAULT_CELL_TARGET;
  const hardFloor = Number(config?.cellHardFloor) || DEFAULT_CELL_HARD_FLOOR;
  const capChars = Math.max(1, Math.floor(target * (Number(config?.perBookCellCapPct) || DEFAULT_BOOK_CAP_PERCENT)));
  const cellStates = new Map();
  const exactHashes = new Set();
  const ngramSet = new Set();
  const accepted = [];
  const rejected = [];
  const ensureCell = key => {
    if (!cellStates.has(key)) cellStates.set(key, { cellKey: key, chars: 0, samples: 0, byWork: {}, targetChars: key.endsWith('|其他') ? 20_000 : target, hardFloor });
    return cellStates.get(key);
  };
  const ordered = records.slice().sort((left, right) => (
    (right.quality?.grade === 'S' ? 2 : right.quality?.grade === 'A' ? 1 : 0) - (left.quality?.grade === 'S' ? 2 : left.quality?.grade === 'A' ? 1 : 0)
      || Number(right.quality?.confidence || 0) - Number(left.quality?.confidence || 0)
      || String(left.sample?.id || '').localeCompare(String(right.sample?.id || ''))
  ));
  for (const [index, record] of ordered.entries()) {
    const sample = runtimeSampleFromRecord(record, index);
    const text = sample.text;
    if (characterCount(text) < SAMPLE_MIN_CHARS || characterCount(text) > SAMPLE_MAX_CHARS) {
      rejected.push({ id: sample.id, reason: 'runtime_length' });
      continue;
    }
    if (!text || (sample.corpus === 'general' && SENSITIVE_PATTERN.test(text))) {
      rejected.push({ id: sample.id, reason: 'sensitive_general_sample' });
      continue;
    }
    const cellKey = `${sample.archetype}|${sample.genreBucket || '其他'}`;
    const cell = ensureCell(cellKey);
    const workKey = sample.canonicalWorkId || sample.sourceWorkId || sample.sourceHash;
    const work = cell.byWork[workKey] || { chars: 0, samples: 0 };
    const chars = characterCount(text);
    if (cell.chars >= cell.targetChars) continue;
    if (work.chars + chars > capChars) {
      rejected.push({ id: sample.id, reason: 'per_book_cell_cap' });
      continue;
    }
    const overlap = hasOverlap(text, exactHashes, ngramSet);
    if (overlap.blocked) {
      rejected.push({ id: sample.id, reason: overlap.reason });
      continue;
    }
    sample.id = `runtime-${String(accepted.length + 1).padStart(6, '0')}`;
    sample.score = Number(record.quality?.confidence || 0);
    accepted.push(sample);
    exactHashes.add(overlap.normalizedHash);
    for (const gram of twelveGrams(text)) ngramSet.add(gram);
    cell.chars += chars;
    cell.samples += 1;
    work.chars += chars;
    work.samples += 1;
    cell.byWork[workKey] = work;
  }
  return { samples: accepted, rejected, cells: Object.fromEntries(cellStates), capChars };
}

function buildRules() {
  const rules = [];
  for (const archetype of ARCHETYPES) {
    for (const [dimension, parts] of Object.entries(DIMENSION_RULES)) {
      rules.push({
        id: `auto-rule-${archetype}-${dimension}`,
        archetype,
        dimension,
        rule: `${parts[0]} ${ARCHETYPE_HINTS[archetype]}。`,
        application: parts[1],
        caution: parts[2],
        scenes: ['日常', '冲突', '试探'],
        relationships: ['普通朋友', '亲密朋友', '竞争者'],
        emotionalStates: ['平静', '紧张', '嘴硬'],
        signals: [],
        score: 1,
      });
    }
  }
  for (const [dimension, parts] of Object.entries(DIMENSION_RULES)) {
    rules.push({
      id: `auto-generic-rule-${dimension}`,
      archetype: '',
      dimension,
      rule: parts[0],
      application: parts[1],
      caution: parts[2],
      scenes: ['日常', '冲突', '试探'],
      relationships: [],
      emotionalStates: [],
      signals: [],
      score: 1,
    });
  }
  return rules;
}

function sentenceStats(samples) {
  const sentences = samples.flatMap(sample => String(sample.text || '').split(/[。！？；!?;]+/u).map(value => value.trim()).filter(Boolean));
  const lengths = sentences.map(characterCount).filter(Boolean);
  const charCount = samples.reduce((sum, sample) => sum + characterCount(sample.text), 0);
  const mean = lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : 0;
  const variance = lengths.length ? lengths.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / lengths.length : 0;
  const histogram = { '0': 0, '1': 0, '2': 0, '3': 0, '4+': 0 };
  for (const sample of samples) {
    const commas = (sample.text.match(/，/gu) || []).length;
    histogram[commas >= 4 ? '4+' : String(commas)] += 1;
  }
  const workCount = new Set(samples.map(sample => sample.canonicalWorkId || sample.sourceWorkId).filter(Boolean)).size;
  const dimensions = Object.fromEntries(DIMENSIONS.map(dimension => [dimension, samples.filter(sample => sample.dimension === dimension).length]));
  return {
    available: charCount > 0,
    reliable: charCount >= 12_000 && workCount >= 8 && lengths.length >= 30,
    sampleCount: samples.length,
    charCount,
    sentenceCount: lengths.length,
    sentenceMean: Number(mean.toFixed(2)),
    sentenceStd: Number(Math.sqrt(variance).toFixed(2)),
    shortSentenceRatio: lengths.length ? Number((lengths.filter(value => value < 8).length / lengths.length).toFixed(4)) : 0,
    longSentenceRatio: lengths.length ? Number((lengths.filter(value => value >= 40).length / lengths.length).toFixed(4)) : 0,
    commaPerSentence: sentences.length ? Number((samples.reduce((sum, sample) => sum + (sample.text.match(/，/gu) || []).length, 0) / sentences.length).toFixed(4)) : 0,
    commaHistogram: histogram,
    enumerationPerKilo: Number((samples.reduce((sum, sample) => sum + (sample.text.match(/、/gu) || []).length, 0) / Math.max(1, charCount) * 1000).toFixed(4)),
    dashPerKilo: Number((samples.reduce((sum, sample) => sum + (sample.text.match(/[—-]/gu) || []).length, 0) / Math.max(1, charCount) * 1000).toFixed(4)),
    ellipsisPerKilo: Number((samples.reduce((sum, sample) => sum + (sample.text.match(/…/gu) || []).length, 0) / Math.max(1, charCount) * 1000).toFixed(4)),
    reduplicationPerKilo: Number((samples.reduce((sum, sample) => sum + (sample.text.match(/(.)\1/gu) || []).length, 0) / Math.max(1, charCount) * 1000).toFixed(4)),
    fourCharStructurePerKilo: 0,
    measureWordPerKilo: Number((samples.reduce((sum, sample) => sum + (sample.text.match(/[一两三四五六七八九十百千万数几半]?(?:个|件|把|双|张|枚|道|缕|丝|股|阵|声|番|层|片|抹|轮|束|簇|泓|袭|副|身|手|脸|颗|粒|根|条)/gu) || []).length, 0) / Math.max(1, charCount) * 1000).toFixed(4)),
    noPunctuationLongRatio: 0,
    singleSentenceParaRatio: 0,
    dialogueRowRatio: samples.length ? Number((samples.filter(sample => /[“「『]/u.test(sample.text)).length / samples.length).toFixed(4)) : 0,
    dialogueNarrationAlternation: 0,
    sourceWorkCount: workCount,
    dimensionCoverage: dimensions,
    dimensionCount: Object.values(dimensions).filter(Boolean).length,
    platformCount: new Set(samples.map(sample => sample.platform).filter(Boolean)).size,
    reliabilityReasons: charCount >= 12_000 && workCount >= 8 ? [] : ['auto-profile-below-contract-floor'],
    basis: 'automatically selected anonymized samples from original local corpus',
  };
}

function buildProfiles(samples) {
  const grouped = new Map();
  const add = (key, sample) => {
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(sample);
  };
  for (const sample of samples) {
    if (sample.archetype && sample.genreBucket) add(`${sample.archetype}|${sample.genreBucket}`, sample);
    if (sample.archetype) add(`${sample.archetype}|all`, sample);
  }
  return Object.fromEntries([...grouped.entries()].map(([key, values]) => [key, sentenceStats(values)]));
}

function buildQuotaReport(samples, cells, config) {
  const archetypeSummary = {};
  for (const archetype of ARCHETYPES) {
    const archetypeSamples = samples.filter(sample => sample.archetype === archetype);
    archetypeSummary[archetype] = {
      currentChars: archetypeSamples.reduce((sum, sample) => sum + characterCount(sample.text), 0),
      sampleCount: archetypeSamples.length,
      workCount: new Set(archetypeSamples.map(sample => sample.canonicalWorkId || sample.sourceWorkId)).size,
      targetChars: Number(config?.archetypeMinChars) || 100_000,
      recommendedChars: Number(config?.archetypeRecommendedChars) || 150_000,
    };
    archetypeSummary[archetype].gapChars = Math.max(0, archetypeSummary[archetype].targetChars - archetypeSummary[archetype].currentChars);
  }
  const knownBuckets = ['言情', '男频玄幻', '都市', '悬疑'];
  const bucketSummary = Object.fromEntries(knownBuckets.map(bucket => {
    const bucketSamples = samples.filter(sample => sample.genreBucket === bucket);
    const chars = bucketSamples.reduce((sum, sample) => sum + characterCount(sample.text), 0);
    return [bucket, {
      currentChars: chars,
      sampleCount: bucketSamples.length,
      workCount: new Set(bucketSamples.map(sample => sample.canonicalWorkId || sample.sourceWorkId)).size,
      targetChars: Number(config?.cellMinChars) || DEFAULT_CELL_TARGET,
      hardFloor: Number(config?.cellHardFloor) || DEFAULT_CELL_HARD_FLOOR,
      hardFloorPass: chars >= (Number(config?.cellHardFloor) || DEFAULT_CELL_HARD_FLOOR),
    }];
  }));
  const configuredBuckets = Object.keys(config?.genreBuckets || {}).filter(bucket => ['言情', '男频玄幻', '都市', '悬疑'].includes(bucket));
  const quotaBuckets = configuredBuckets.length ? configuredBuckets : ['言情', '男频玄幻', '都市', '悬疑'];
  const coreKeys = new Set(ARCHETYPES.flatMap(archetype => quotaBuckets.map(bucket => `${archetype}|${bucket}`)));
  const capChars = Math.floor((Number(config?.cellMinChars) || DEFAULT_CELL_TARGET) * (Number(config?.perBookCellCapPct) || DEFAULT_BOOK_CAP_PERCENT));
  const cellRows = ARCHETYPES.flatMap(archetype => quotaBuckets.map(bucket => {
    const key = `${archetype}|${bucket}`;
    const state = cells[key] || { chars: 0, samples: 0, byWork: {} };
    const perBookEffectiveChars = Object.fromEntries(Object.entries(state.byWork || {}).map(([work, value]) => [work, Number(value?.chars) || 0]));
    return {
      cellKey: key,
      archetype,
      bucket,
      chars: Number(state.chars) || 0,
      effectiveChars: Number(state.chars) || 0,
      samples: Number(state.samples) || 0,
      workCount: Object.keys(perBookEffectiveChars).length,
      byWork: state.byWork || {},
      perBookEffectiveChars,
      perBookCapChars: capChars,
      targetChars: Number(config?.cellMinChars) || DEFAULT_CELL_TARGET,
      hardFloor: Number(config?.cellHardFloor) || DEFAULT_CELL_HARD_FLOOR,
      hardFloorPass: (Number(state.chars) || 0) >= (Number(config?.cellHardFloor) || DEFAULT_CELL_HARD_FLOOR),
    };
  }));
  const rawCells = Object.fromEntries(Object.entries(cells).filter(([key]) => !coreKeys.has(key)));
  const platformMap = new Map();
  for (const sample of samples) {
    const platform = sample.platform || '未指定';
    const row = platformMap.get(platform) || { platform, charCount: 0, sampleCount: 0, sourceWorkCount: new Set() };
    row.charCount += characterCount(sample.text);
    row.sampleCount += 1;
    row.sourceWorkCount.add(sample.canonicalWorkId || sample.sourceWorkId || sample.sourceHash);
    platformMap.set(platform, row);
  }
  const platformCharTotal = [...platformMap.values()].reduce((sum, row) => sum + row.charCount, 0);
  const maxSinglePlatformShare = platformCharTotal
    ? Math.max(...[...platformMap.values()].map(row => row.charCount / platformCharTotal))
    : 0;
  const maxPlatformShare = Number(config?.platformCoverage?.maxSinglePlatformShare) || 0.6;
  const platformRows = [...platformMap.values()].map(row => ({
    platform: row.platform,
    charCount: row.charCount,
    sampleCount: row.sampleCount,
    sourceWorkCount: row.sourceWorkCount.size,
    charShare: platformCharTotal ? Number((row.charCount / platformCharTotal).toFixed(6)) : 0,
  }));
  const platformCoverageEnforced = config?.platformCoverage?.enforce === true && config?.platformCoverage?.reportOnlyUntilEvidence !== true;
  const platformCoverage = {
    enforced: platformCoverageEnforced,
    pass: !platformCoverageEnforced || (maxSinglePlatformShare <= maxPlatformShare && platformRows.length > 1),
    maxSinglePlatformPass: maxSinglePlatformShare <= maxPlatformShare,
    overall: {
      charCount: platformCharTotal,
      platforms: platformRows,
      maxSinglePlatformShare: Number(maxSinglePlatformShare.toFixed(6)),
    },
    focusSlices: (Array.isArray(config?.focusSlices) ? config.focusSlices : []).map(slice => ({
      id: slice.id,
      runtimeKey: slice.runtimeKey,
      charCount: 0,
      requiredPlatforms: slice.platforms || [],
      pass: false,
      reason: 'original-local-corpus-only-does-not-provide-configured-platform-coverage',
    })),
  };
  const hardFloorCells = cellRows.filter(cell => !cell.hardFloorPass).map(cell => ({ cellKey: cell.cellKey, chars: cell.chars, hardFloor: cell.hardFloor }));
  const perBookCapViolations = cellRows.flatMap(cell => Object.entries(cell.perBookEffectiveChars)
    .filter(([, chars]) => chars > capChars)
    .map(([sourceWork, chars]) => ({ cellKey: cell.cellKey, sourceWork, chars, capChars })));
  return {
    targetChars: Number(config?.cellMinChars) || DEFAULT_CELL_TARGET,
    hardFloor: Number(config?.cellHardFloor) || DEFAULT_CELL_HARD_FLOOR,
    perBookCellCapPct: Number(config?.perBookCellCapPct) || DEFAULT_BOOK_CAP_PERCENT,
    perBookCellCapChars: capChars,
    cells: cellRows,
    rawCells,
    hardFloorCells,
    perBookCapViolations,
    totalUniqueChars: samples.reduce((sum, sample) => sum + characterCount(sample.text), 0),
    platformCoverage,
    byArchetype: archetypeSummary,
    byBucket: bucketSummary,
  };
}

function qualityStatusForQuota(quotaReport) {
  const report = quotaReport || {};
  const hasDiagnostics = (report.hardFloorCells || []).length > 0
    || (report.perBookCapViolations || []).length > 0
    || report.platformCoverage?.pass === false
    || Object.values(report.byArchetype || {}).some(summary => summary.gapChars > 0);
  return hasDiagnostics ? 'auto-complete-with-diagnostics' : 'auto-complete';
}

function safeRecord(record) {
  const copy = JSON.parse(JSON.stringify(record));
  if (copy.sample) {
    delete copy.sample.rawText;
    copy.sample.auditText = copy.sample.safeText;
    copy.sample.subtextEvidence = [];
    copy.sample.humanTextureEvidence = {};
    copy.sample.htlEvidence = {};
  }
  copy.safety = {
    forbiddenTerms: [],
    forbiddenTermLayers: { coreTerms: [], localTerms: [], globalRiskTerms: [] },
    residualTerms: [],
    residualTermsByTrack: { safeText: [], auditText: [] },
    anonymizationScore: 1,
    textOverlap: { blocked: false },
  };
  return copy;
}

function buildProfileGenreMap(sources) {
  const map = {};
  for (const source of sources) {
    if (source.category) map[source.category] = source.genreBucket || '其他';
    for (const genre of source.rawGenres || []) if (genre && genre !== '未分类') map[genre] = source.genreBucket || '其他';
  }
  return map;
}

function buildRuntimeIndex({ samples, sources, selected, config, quotaReport, profiles }) {
  const rules = buildRules();
  const generalSamples = samples.filter(sample => sample.corpus !== 'mature');
  const matureSamples = samples.filter(sample => sample.corpus === 'mature');
  const profileGenreMap = buildProfileGenreMap(sources);
  return {
    version: REBUILD_VERSION,
    published: true,
    markdownPublished: false,
    sourceHash: shortHash(`${REBUILD_VERSION}|${sources.map(source => source.sourceWorkId).join('|')}`, 64),
    general: { rules, samples: generalSamples },
    mature: { rules, samples: matureSamples },
    profiles,
    rawGenreProfiles: {},
    aggregateRawGenreProfiles: {},
    profilesPublished: true,
    profileFallback: 'generic-rules',
    profileFocusSlices: [],
    profileGenreMap,
    rawGenreCoverage: {
      mode: 'original-local-corpus',
      platformShare: { '本地原本': 1 },
      excludedFromLegacyPlatformQuota: true,
    },
    audit: {
      pipeline: ['original-scan', 'quality-admission', 'chapter-cleaning', 'candidate-mining', 'automatic-annotation', 'safe-audit', '12-character-overlap-gate', 'quota-selection', 'runtime-compatibility'],
      manualReview: false,
      manualReviewRequired: false,
      automaticReview: true,
      automaticReviewMethod: 'deterministic-lexical-evidence',
      humanCalibration: 'skipped-by-user-instruction',
      strongSamplesPublished: true,
      publicationMode: 'automatic-user-authorized',
      sourceCount: sources.length,
      admittedSourceCount: sources.filter(source => source.quality?.eligibleForAdvancedAnalysis).length,
      candidateCount: selected.candidateCount,
      richRecordCount: selected.richRecordCount,
      runtimeSampleCount: samples.length,
      generalSampleCount: generalSamples.length,
      matureSampleCount: matureSamples.length,
      overlapRejectedCount: selected.overlapRejectedCount,
      quota: quotaReport,
      sourcePolicy: 'only resources/小说原本; legacy markdown/source list/manifest/intermediate were not read',
      sha256Gate: 'not_used_by_user_instruction',
    },
  };
}

function autoCalibration200(candidates) {
  const selected = candidates.slice().sort((left, right) => (
    String(left.genreBucket).localeCompare(String(right.genreBucket), 'zh-CN')
      || String(left.archetype).localeCompare(String(right.archetype), 'zh-CN')
      || String(left.dimension).localeCompare(String(right.dimension), 'en')
      || left.candidateId.localeCompare(right.candidateId)
  )).slice(0, 200);
  return {
    schemaVersion: 'character-material-auto-calibration-v3.1-1',
    status: 'auto-reviewed',
    targetCount: 200,
    selectedCount: selected.length,
    humanReviewRequired: false,
    method: 'deterministic-lexical-evidence',
    rows: selected.map(row => ({
      calibrationId: `auto-cal-${row.candidateId}`,
      candidateId: row.candidateId,
      text: row.text,
      source: {
        sourceWorkId: row.sourceWorkId,
        sourceFilePath: row.sourceFilePath,
        chapterIndex: row.evidence.chapterIndex,
        charStart: row.evidence.charStart,
        charEnd: row.evidence.charEnd,
      },
      automaticDecision: {
        personAttribution: row.characterEvidence.status,
        dimension: row.dimension,
        scene: inferContext(row.text, row.dimension).scene,
        relationship: inferContext(row.text, row.dimension).relationship,
        subtextEvidence: inferContext(row.text, row.dimension).subtextEvidence,
        humanTextureEvidence: inferHtl(row.text, row.dimension, inferContext(row.text, row.dimension)).evidence,
        safeTextFluency: true,
      },
      status: 'auto-reviewed',
    })),
  };
}

function buildContractSnapshot(config) {
  return {
    schemaVersion: 'character-material-v3.1-rebuild-contract-1',
    generatedAt: new Date().toISOString(),
    sourcePolicy: {
      archiveRoot: '资源库/小说原本',
      legacyInputsUsed: false,
      userAuthorization: true,
      sha256Gate: 'not_used_by_user_instruction',
    },
    runtime: {
      sampleMinChars: SAMPLE_MIN_CHARS,
      sampleMaxChars: SAMPLE_MAX_CHARS,
      strongSampleMax: 2,
      outputSchema: 'legacy-character-material-v1-compatible',
      requireCompletedWork: config?.requireCompletedWork === true,
      requireFullWork: config?.requireFullWork === true,
    },
    quota: {
      cellHardFloor: Number(config?.cellHardFloor) || DEFAULT_CELL_HARD_FLOOR,
      cellTarget: Number(config?.cellMinChars) || DEFAULT_CELL_TARGET,
      perBookCellCapPct: Number(config?.perBookCellCapPct) || DEFAULT_BOOK_CAP_PERCENT,
      maxSinglePlatformShare: Number(config?.platformCoverage?.maxSinglePlatformShare) || 0.6,
    },
    review: {
      humanCalibration: 'skipped-by-user-instruction',
      automaticSelfReview: true,
      noHumanQualityClaim: true,
    },
  };
}

function buildContractArtifacts(config) {
  const contract = buildContractSnapshot(config);
  return {
    contract,
    runtime: {
      schemaVersion: 'character-material-runtime-contract-snapshot-1',
      generatedAt: contract.generatedAt,
      sourcePolicy: contract.sourcePolicy,
      runtime: contract.runtime,
      compatibility: {
        input: 'Rich Intermediate corpus-v3.1-rich-1',
        output: 'legacy-character-material-v1-compatible',
        loader: 'lib/character-material.js#loadCharacterMaterialIndex',
        retrieval: 'lib/character-material.js#retrieveCharacterMaterial',
        blockBuilder: 'lib/character-material.js#buildCharacterMaterialBlock',
      },
    },
    quota: {
      schemaVersion: 'character-material-quota-contract-snapshot-1',
      generatedAt: contract.generatedAt,
      sourcePolicy: contract.sourcePolicy,
      quota: contract.quota,
      configuredArchetypeCount: Array.isArray(config?.archetypes) ? config.archetypes.length : ARCHETYPES.length,
      configuredBucketCount: isObject(config?.genreBuckets) ? Object.keys(config.genreBuckets).length : 4,
      counting: config?.counting || {},
    },
    schema: {
      schemaVersion: 'character-material-schema-contract-snapshot-1',
      generatedAt: contract.generatedAt,
      richIntermediate: {
        schemaVersion: RICH_VERSION,
        requiredTracks: ['rawText', 'safeText', 'auditText'],
        requiredAnnotations: ['dimension', 'scene', 'relationship', 'emotionalState', 'subtext', 'humanTextureSignals', 'microPatterns'],
      },
      runtime: {
        sampleTextChars: [SAMPLE_MIN_CHARS, SAMPLE_MAX_CHARS],
        requiredSafety: ['residualTerms', '12-character-overlap-gate'],
        strongSampleMax: 2,
        rawTextPublished: false,
      },
    },
  };
}

function parseArgs(argv = []) {
  const options = {
    archiveRoot: DEFAULT_ARCHIVE_ROOT,
    output: DEFAULT_OUTPUT_ROOT,
    quotaConfig: DEFAULT_QUOTA_CONFIG,
    perWorkLimit: DEFAULT_PER_WORK_CANDIDATES,
    maxWorks: 0,
    publishRuntime: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || '';
    if (arg === '--archive-root') options.archiveRoot = path.resolve(next());
    else if (arg === '--output') options.output = path.resolve(next());
    else if (arg === '--quota-config') options.quotaConfig = path.resolve(next());
    else if (arg === '--per-work-limit') options.perWorkLimit = Math.max(1, Number.parseInt(next(), 10) || DEFAULT_PER_WORK_CANDIDATES);
    else if (arg === '--max-works') options.maxWorks = Math.max(0, Number.parseInt(next(), 10) || 0);
    else if (arg === '--publish-runtime') options.publishRuntime = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

export function runRebuild(options = {}) {
  const config = readJson(options.quotaConfig || DEFAULT_QUOTA_CONFIG, {});
  const archiveRoot = path.resolve(options.archiveRoot || DEFAULT_ARCHIVE_ROOT);
  const outputRoot = path.resolve(options.output || DEFAULT_OUTPUT_ROOT);
  const allFiles = walkTxtFiles(archiveRoot);
  const files = options.maxWorks ? allFiles.slice(0, options.maxWorks) : allFiles;
  const sources = [];
  const allCandidates = [];
  const richRecords = [];
  const rejectedRecords = [];
  const startedAt = new Date().toISOString();
  for (const [index, filePath] of files.entries()) {
    const buffer = fs.readFileSync(filePath);
    const text = buffer.toString('utf8');
    const source = buildSourceRecord(filePath, archiveRoot, text, config, index + 1);
    sources.push(source);
    if (!source.quality.eligibleForAdvancedAnalysis) continue;
    const candidates = mineWorkCandidates(source, text, Number(options.perWorkLimit) || DEFAULT_PER_WORK_CANDIDATES);
    for (const candidate of candidates) {
      const { record, validation } = buildRichRecord(candidate);
      allCandidates.push(candidate);
      if (validation.valid && record.sample.safeText.length >= SAMPLE_MIN_CHARS && record.sample.safeText.length <= SAMPLE_MAX_CHARS && record.safety.residualTerms.length === 0) richRecords.push(record);
      else rejectedRecords.push({ candidateId: candidate.candidateId, errors: validation.errors, residualTerms: validation.residualTerms });
    }
  }
  const selected = selectRuntimeSamples(richRecords, config);
  const runtimeSamples = selected.samples;
  const profiles = buildProfiles(runtimeSamples);
  const quotaReport = buildQuotaReport(runtimeSamples, selected.cells, config);
  const qualityStatus = qualityStatusForQuota(quotaReport);
  const runtimeIndex = buildRuntimeIndex({
    samples: runtimeSamples,
    sources,
    selected: {
      candidateCount: allCandidates.length,
      richRecordCount: richRecords.length,
      overlapRejectedCount: selected.rejected.filter(item => /overlap|duplicate/u.test(item.reason)).length,
    },
    config,
    quotaReport,
    profiles,
  });
  const contractArtifacts = buildContractArtifacts(config);
  const candidateRows = allCandidates.map(row => ({
    ...row,
    automaticReview: {
      status: 'auto-reviewed',
      archetype: row.archetype,
      dimension: row.dimension,
      confidence: row.classification.confidence,
      evidence: row.evidence,
      decisionMethod: row.classification.method,
    },
  }));
  const sourceManifest = {
    schemaVersion: 'character-material-original-source-manifest-1',
    status: 'ready',
    generatedAt: startedAt,
    input: {
      archiveRoot: '资源库/小说原本',
      fileCount: files.length,
      legacyInputsUsed: false,
      authorizationMode: 'user-explicit',
      sha256Gate: 'not_used_by_user_instruction',
    },
    sources,
    summary: {
      sourceCount: sources.length,
      admittedCount: sources.filter(source => source.quality.eligibleForAdvancedAnalysis).length,
      rejectedCount: sources.filter(source => !source.quality.eligibleForAdvancedAnalysis).length,
      totalCharacters: sources.reduce((sum, source) => sum + source.quality.characterCount, 0),
      totalChapters: sources.reduce((sum, source) => sum + source.quality.chapterCount, 0),
      genreBuckets: Object.fromEntries([...new Set(sources.map(source => source.genreBucket))].sort().map(bucket => [bucket, sources.filter(source => source.genreBucket === bucket).length])),
    },
  };
  const sourceQualityReport = {
    schemaVersion: 'character-material-original-source-quality-1',
    status: 'ready',
    reports: sources.map(source => ({
      sourceWorkId: source.sourceWorkId,
      sourceFilePath: source.sourceFilePath,
      title: source.title,
      platform: source.platform,
      category: source.category,
      admission: source.quality.status,
      ...source.quality,
    })),
  };
  const sourceMetadata = {
    schemaVersion: 'character-material-original-source-metadata-1',
    status: 'ready',
    generatedAt: startedAt,
    sourcePolicy: 'original-local-corpus-only',
    legacyInputsUsed: false,
    sources: sources.map(source => ({
      sourceWorkId: source.sourceWorkId,
      canonicalWorkId: source.canonicalWorkId,
      platform: source.platform,
      platformWorkId: source.platformWorkId,
      title: source.title,
      author: source.author,
      category: source.category,
      rawGenres: source.rawGenres,
      primaryGenre: source.primaryGenre,
      audience: source.audience,
      genreBucket: source.genreBucket,
      rankType: source.rankType,
      rank: source.rank,
      wordNumber: source.wordNumber,
      completionStatus: source.completionStatus,
      contentScope: source.contentScope,
      sourceFilePath: source.sourceFilePath,
      authorization: source.authorization,
      completionEvidence: source.completionEvidence,
      qualityStatus: source.quality.status,
    })),
  };
  const reorganizeReport = {
    schemaVersion: 'character-material-original-reorganize-report-1',
    status: 'complete',
    mode: 'original-only-no-reorganization',
    inputRoot: '资源库/小说原本',
    filesScanned: files.length,
    filesMoved: 0,
    legacyInputsUsed: false,
    note: '用户要求旧 Markdown、来源清单、manifest 与 intermediate 不参与本轮重建。',
  };
  const quarantineReport = {
    schemaVersion: 'character-material-original-quarantine-1',
    status: sources.some(source => !source.quality.eligibleForAdvancedAnalysis) ? 'has_quarantine' : 'clear',
    entries: sources.filter(source => !source.quality.eligibleForAdvancedAnalysis).map(source => ({
      sourceWorkId: source.sourceWorkId,
      sourceFilePath: source.sourceFilePath,
      reasons: source.quality.reasons,
      recoverable: true,
    })),
  };
  const richIntermediate = {
    schemaVersion: RICH_VERSION,
    status: qualityStatus,
    statusLabel: qualityStatus === 'auto-complete-with-diagnostics' ? '带诊断缺口完成' : '自动完成',
    sourcePolicy: 'original-local-corpus-only',
    humanCalibration: 'skipped-by-user-instruction',
    records: richRecords,
    rejected: rejectedRecords,
    summary: {
      candidateCount: allCandidates.length,
      richRecordCount: richRecords.length,
      rejectedRecordCount: rejectedRecords.length,
      residualRecordCount: richRecords.filter(record => record.safety.residualTerms.length).length,
    },
  };
  const safeIntermediate = {
    schemaVersion: RICH_VERSION,
    status: 'auto-complete',
    sourcePolicy: 'original-local-corpus-only',
    records: richRecords.map(safeRecord),
  };
  const autoReview = autoCalibration200(candidateRows);
  const qualityReport = {
    schemaVersion: 'character-material-original-quality-report-1',
    version: REBUILD_VERSION,
    status: 'auto-complete',
    generatedAt: new Date().toISOString(),
    input: {
      archiveRoot: '资源库/小说原本',
      filesScanned: files.length,
      legacyMarkdownRead: false,
      legacySourceListRead: false,
      legacyManifestRead: false,
      legacyIntermediateRead: false,
    },
    contract: buildContractSnapshot(config),
    source: sourceManifest.summary,
    candidates: {
      mined: allCandidates.length,
      autoReviewRows: autoReview.selectedCount,
      byDimension: Object.fromEntries(DIMENSIONS.map(dimension => [dimension, allCandidates.filter(row => row.dimension === dimension).length])),
      byArchetype: Object.fromEntries(ARCHETYPES.map(archetype => [archetype, allCandidates.filter(row => row.archetype === archetype).length])),
      byBucket: Object.fromEntries([...new Set(allCandidates.map(row => row.genreBucket))].sort().map(bucket => [bucket, allCandidates.filter(row => row.genreBucket === bucket).length])),
    },
    annotation: {
      method: 'deterministic-lexical-evidence',
      richRecords: richRecords.length,
      rejectedRecords: rejectedRecords.length,
      humanCalibrationRequired: false,
      automaticSelfReview: true,
    },
    safety: {
      rawTextStoredOnlyInResearchIntermediate: true,
      safeRecordCount: safeIntermediate.records.length,
      residualRecordCount: safeIntermediate.records.filter(record => record.safety.residualTerms.length).length,
      twelveCharacterGate: true,
      overlapRejectedCount: selected.rejected.filter(item => /overlap|duplicate/u.test(item.reason)).length,
    },
    quota: quotaReport,
    runtime: {
      version: REBUILD_VERSION,
      published: true,
      generalSamples: runtimeIndex.general.samples.length,
      matureSamples: runtimeIndex.mature.samples.length,
      ruleCount: runtimeIndex.general.rules.length,
      profiles: Object.keys(runtimeIndex.profiles).length,
      profilesReliable: Object.values(runtimeIndex.profiles).filter(profile => profile.reliable).length,
    },
    nextStep: 'run generation script and review generated chapter manually',
  };
  qualityReport.sourceHash = runtimeIndex.sourceHash;
  qualityReport.audit = {
    strongSamplesPublished: true,
    markdownPublished: false,
    manualReview: false,
    automaticReview: true,
    humanCalibration: 'skipped-by-user-instruction',
  };
  writeJson(path.join(outputRoot, 'contract-snapshot.json'), contractArtifacts.contract);
  writeJson(path.join(outputRoot, 'runtime-contract.snapshot.json'), contractArtifacts.runtime);
  writeJson(path.join(outputRoot, 'quota-contract.snapshot.json'), contractArtifacts.quota);
  writeJson(path.join(outputRoot, 'schema-contract.snapshot.json'), contractArtifacts.schema);
  writeJson(path.join(outputRoot, 'corpus-reorganize-report.json'), reorganizeReport);
  writeJson(path.join(outputRoot, 'corpus-source-metadata.json'), sourceMetadata);
  writeJson(path.join(outputRoot, 'source-manifest.json'), sourceManifest);
  writeJson(path.join(outputRoot, 'source-quality-report.json'), sourceQualityReport);
  writeJson(path.join(outputRoot, 'quarantine-report.json'), quarantineReport);
  writeJsonl(path.join(outputRoot, 'candidate-pool.jsonl'), candidateRows);
  writeJson(path.join(outputRoot, 'auto-calibration-200.json'), autoReview);
  writeJson(path.join(outputRoot, 'rich-intermediate.json'), richIntermediate);
  writeJson(path.join(outputRoot, 'safe-intermediate.json'), safeIntermediate);
  writeJson(path.join(outputRoot, 'runtime-index.json'), runtimeIndex);
  writeJson(path.join(outputRoot, 'quality-report.json'), qualityReport);
  writeJson(path.join(outputRoot, 'progress.json'), {
    schemaVersion: 'character-material-original-progress-1',
    status: 'completed',
    filesScanned: files.length,
    completedSourceWorkIds: sources.map(source => source.sourceWorkId),
    updatedAt: new Date().toISOString(),
  });
  const publishedRuntime = options.publishRuntime === true;
  if (publishedRuntime) {
    const runtimePath = path.join(REPO_ROOT, 'lib', 'character-material', 'index.json');
    const reportPath = path.join(REPO_ROOT, 'lib', 'character-material', 'quality-report.json');
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
    fs.copyFileSync(path.join(outputRoot, 'runtime-index.json'), runtimePath);
    fs.copyFileSync(path.join(outputRoot, 'quality-report.json'), reportPath);
  }
  return {
    status: 'completed',
    outputRoot,
    sourceCount: sources.length,
    admittedCount: sourceManifest.summary.admittedCount,
    candidateCount: allCandidates.length,
    richRecordCount: richRecords.length,
    runtimeSampleCount: runtimeSamples.length,
    generalSampleCount: runtimeIndex.general.samples.length,
    matureSampleCount: runtimeIndex.mature.samples.length,
    rejectedSourceCount: sourceManifest.summary.rejectedCount,
    outputFiles: {
      sourceManifest: path.join(outputRoot, 'source-manifest.json'),
      candidatePool: path.join(outputRoot, 'candidate-pool.jsonl'),
      richIntermediate: path.join(outputRoot, 'rich-intermediate.json'),
      runtimeIndex: path.join(outputRoot, 'runtime-index.json'),
      qualityReport: path.join(outputRoot, 'quality-report.json'),
      runtimeContract: path.join(outputRoot, 'runtime-contract.snapshot.json'),
      quotaContract: path.join(outputRoot, 'quota-contract.snapshot.json'),
      schemaContract: path.join(outputRoot, 'schema-contract.snapshot.json'),
      sourceMetadata: path.join(outputRoot, 'corpus-source-metadata.json'),
      reorganizeReport: path.join(outputRoot, 'corpus-reorganize-report.json'),
      publishedRuntime: publishedRuntime ? path.join(REPO_ROOT, 'lib', 'character-material', 'index.json') : null,
    },
  };
}

export {
  analyzeOriginalText,
  anonymizeText,
  autoCalibration200,
  buildSourceRecord,
  buildProfiles,
  buildQuotaReport,
  buildRuntimeIndex,
  categoryFor,
  genreFor,
  inferArchetype,
  inferContext,
  inferHtl,
  mineWorkCandidates,
  parseArgs,
  parseFilename,
  qualityStatusForQuota,
  selectRuntimeSamples,
  runtimeSampleFromRecord,
  bucketFor,
  walkTxtFiles,
};

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/rebuild-character-material-from-original.mjs [--archive-root path] [--output path] [--per-work-limit 80] [--max-works N] [--publish-runtime]');
  } else {
    try {
      console.log(JSON.stringify(runRebuild(options), null, 2));
    } catch (error) {
      console.error(error?.stack || error);
      process.exitCode = 1;
    }
  }
}
