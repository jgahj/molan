import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  detectFanfiction,
  detectForumLike,
  detectIncomplete,
  splitChapters
} from '../../资源库/scripts/build-manifest.mjs';
import {
  buildSourceLookup as buildUnifiedSourceLookup,
  canonicalizeRawGenre,
  canonicalizeRawGenres,
  canonicalizeSourceUrl,
  calculateRawGenreCoverage,
  corpusSampleKey,
  corpusTextHash,
  countCorpusChars,
  enrichCorpusRow,
  evaluateArchiveRecord,
  evaluateAuthorization,
  logicalWorkId,
  normalizeAudience,
  normalizeCompletionStatus,
  normalizeCorpusText,
  normalizeRanking,
  normalizeSourceRecord,
  primaryGenreBucket,
  splitRawGenres
} from '../../资源库/scripts/corpus-utils.mjs';

import { loadCharacterLibraryNames } from './character-library-names.mjs';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..');
const RESOURCE_ROOT = path.resolve(REPOSITORY_ROOT, '..', '资源库');
const DEFAULT_INPUT = path.join(RESOURCE_ROOT, '人物描写素材库_真实抓取版.md');
const DEFAULT_SOURCES = path.join(RESOURCE_ROOT, '人物描写素材库_来源清单.json');
const DEFAULT_QUOTA_CONFIG = path.join(RESOURCE_ROOT, 'quota-config.json');
const DEFAULT_ARCHIVE_MANIFEST = path.join(RESOURCE_ROOT, 'manifest.json');
const DEFAULT_BLOCKLIST = path.join(RESOURCE_ROOT, 'ip-blocklist.json');
const DEFAULT_OUTPUT = path.join(REPOSITORY_ROOT, 'lib', 'character-material');
const DEFAULT_INTERMEDIATE = path.join(RESOURCE_ROOT, 'intermediate');
const DEFAULT_MARKDOWN_OUTPUT = path.join(RESOURCE_ROOT, '人物描写素材库_发布版.md');
const VERSION = 'corpus-v3';
const PIPELINE_REVISION = 'corpus-v3.5-entity-evidence-gate-1';
const MODEL_REVIEW_PROMPT_VERSION = 'character-candidate-review-v3';
const MIN_CANDIDATE_CHARS = 24;
const MAX_CANDIDATE_CHARS = 1000;
const ARCHETYPES = [
  '豪爽侠义型', '冷静理智型', '温柔内敛型', '活泼开朗型', '阴郁腹黑型',
  '霸道强势型', '天真烂漫型', '市侩圆滑型', '高傲冷峻型', '热血冲动型'
];
const DIMENSIONS = [
  ['appearance', '外貌'], ['expression', '神态'], ['action', '动作'],
  ['dialogue', '语言'], ['catchphrase', '口头禅'], ['psychology', '心理']
];
const DEFAULT_GENRE_BUCKETS = Object.freeze({
  '言情': ['现言', '古言', '言情衍生', '言情'],
  '男频玄幻': ['玄幻', '奇幻', '仙侠', '武侠'],
  '都市': ['都市', '职场', '校园', '现实'],
  '悬疑': ['悬疑', '推理', '惊悚', '惊险']
});
const DEFAULT_RAW_GENRES = Object.freeze([
  '玄幻', '奇幻', '武侠', '仙侠', '都市', '现实', '游戏', '体育', '科幻',
  '悬疑', '轻小说', '言情', '推理', '惊险', '纪实', '动漫', '乡土', '耽美'
]);
const ARCHIVE_DIMENSION_PATTERNS = Object.freeze({
  appearance: /头发|眉|眼睛|双眼|眸|鼻|唇|嘴角|脸|面容|皮肤|身材|身形|身高|衣着|穿着|长发|短发|高大|清瘦|白皙|苍白|红润/u,
  expression: /神色|神情|面色|脸色|眼神|目光|眉头|眉梢|嘴角|唇角|呼吸|眸光|瞳孔|怔|愣|惊|怒|笑|哭|抿唇|咬唇/u,
  action: /抬|垂|握|抓|捏|咬|转身|站起|坐下|走去|跑|退|进|靠|伸|收|挡|推|拉|抱|扶|拍|踢|冲|扑|躲|停下|回头|点头|摇头/u,
  dialogue: /[“「『][^”」』\r\n]{2,}[”」』]/u,
  catchphrase: /[“「『][^”」』]*(?:嗯|啊|哎|唉|啧|喂|没事|行了|算了|得了|我说|你看|不是|好家伙)[^”」』]*[”」』]/u,
  psychology: /心想|想到|觉得|意识到|心中|心里|担心|害怕|不安|怀疑|决定|念头|记得|想起|思绪|后悔|庆幸|期望|渴望|不由得/u
});
const ARCHETYPE_LEXICAL_RULES = Object.freeze({
  '豪爽侠义型': [/豪爽|爽快|痛快|仗义|义气|直爽|洒脱|大方|干脆|兄弟|交给我|我来/u],
  '冷静理智型': [/冷静|理智|证据|分析|判断|核对|谨慎|审慎|观察|推断|计划|先.{0,8}再|沉着|不动声色/u],
  '温柔内敛型': [/温柔|体贴|照顾|安慰|轻声|小心翼翼|默默|垂眸|欲言又止|抿唇|没关系|不用担心|替.{0,8}(?:整理|盖|擦|扶)/u],
  '活泼开朗型': [/活泼|开朗|乐观|兴奋|欢快|蹦|跳|笑嘻嘻|打趣|调侃|热闹|哈哈|哎呀/u],
  '阴郁腹黑型': [/阴沉|阴郁|腹黑|算计|试探|讥讽|嘲|危险|眯眼|布局|利用|报复|杀意|冷笑/u],
  '霸道强势型': [/命令|必须|不许|滚|闭嘴|掌控|强势|霸道|冷声|拦住|抓住|不容拒绝|我说了算/u],
  '天真烂漫型': [/天真|单纯|烂漫|懵懂|好奇|为什么|真的吗|眨眼|惊讶|开心|第一次|好玩/u],
  '市侩圆滑型': [/利益|价钱|银子|报酬|买卖|稳赚|讨价|客套|赔笑|见风使舵|打哈哈|方便|生意|得罪不起/u],
  '高傲冷峻型': [/高傲|冷峻|孤傲|不屑|淡淡|漠然|疏离|嗤笑|懒得|无需|居高临下|冷冷地/u],
  '热血冲动型': [/热血|冲上|怒吼|暴躁|忍不住|立刻|马上|拔|挥|冲|战|拼|怒|大喊|不服/u]
});
const FOUR_CHAR_TERMS = Object.freeze('一言不发 一声不吭 不动声色 不慌不忙 不紧不慢 不急不躁 不知所措 不由自主 不可思议 不以为意 不动如山 不露声色 不着痕迹 不假思索 不屑一顾 不以为然 不可避免 不知不觉 不言而喻 七上八下 七零八落 大惊失色 大喜过望 大步流星 大快人心 大言不惭 大摇大摆 大惊小怪 小心翼翼 小题大做 小心谨慎 小鸟依人 心平气和 心神不宁 心不在焉 心照不宣 心有余悸 心领神会 心急如焚 心灰意冷 心惊肉跳 心满意足 心安理得 目不转睛 目瞪口呆 目光如炬 目中无人 目不斜视 头也不回 头昏脑涨 头重脚轻 眉头紧皱 眉开眼笑 眉飞色舞 眉清目秀 眉来眼去 轻描淡写 轻手轻脚 轻声细语 轻车熟路 轻装上阵 轻而易举 轻举妄动 轻蔑一笑 低声下气 低眉顺眼 低头不语 低头沉思 低声细语 低吟浅唱 低调做人 似笑非笑 若有所思 若无其事 若即若离 若隐若现 若有所失 言简意赅 言听计从 言归正传 言不由衷 言之凿凿 言笑晏晏 语重心长 语无伦次 语气平静 语气冷淡 语气坚定 语气温和 语气强硬 眉眼弯弯 眼神冰冷 眼神复杂 眼神闪烁'.split(/\s+/));
const MEASURE_WORD_PATTERN = /[一两三四五六七八九十百千万数几半]?(?:个|件|把|双|张|枚|道|缕|丝|股|阵|声|番|层|片|抹|丝|缕|道|轮|束|簇|泓|袭|袭|副|身|手|脸|颗|粒|根|条|柄|杆|方|座|栋|间|辆|艘|匹|头|只|尾|朵|簇|团|圈|缕|缭)/gu;
const SENSITIVE_PATTERN = /露骨|下身|阴茎|阴部|乳房|乳头|性交|做爱|高潮|插入|性器官|呻吟|床笫|媾合|肉棒|精液|裸身|裸体|春药|发情|淫靡|潮吹/i;
const SURNAME_PATTERN = /[赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄麹家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴郁胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍却璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公万俟司马上官欧阳夏侯诸葛闻人东方赫连皇甫尉迟公羊澹台公冶宗政濮阳淳于单于太叔申屠公孙仲孙轩辕令狐钟离宇文长孙慕容鲜于闾丘司徒司空亓官司寇仉督子车颛孙端木巫马公西漆雕乐正壤驷公良拓跋夹谷宰父谷梁晋楚闫法汝鄢涂钦段干百里东郭南门呼延归海羊舌微生岳帅缑亢况后有琴梁丘左丘东门西门商牟佘佴伯赏南宫墨哈谯笪年爱阳佟第五言福]/u;
const NAME_TAIL_PATTERN = /[的地得着了过在会将被很还也又就便而把让从向对跟为与和心手头脸眼身口形色气体影边里外前后上下一声]/u;
const NAME_ACTION_CONTEXT_PATTERN = /[说问道看望盯瞥抬低垂握抓捏咬笑哭走跑退进靠转停开起坐躲挡拦劝骂喊叫答应问起察觉发现觉得开始继续突然死稍眯住沉抱拿接推带钻想见伸激打扎]/u;
const NAME_SUFFIX_CONTEXT_PATTERN = /[说问道看望盯瞥抬低垂握抓捏咬笑哭走跑退进靠转停开起坐躲挡拦劝骂喊叫答应察觉发现开始继续突然死稍眯住沉抱拿接推带钻想见伸激打扎]/u;
const NAME_PREFIX_CONTEXT_PATTERN = /[将被把让从向对跟为与和给于由按同]/u;
const NAME_MODIFIER_PATTERN = /[大小老少新旧]/u;
// The source corpus is literary Chinese, so a broad surname character class
// treats ordinary words such as "人物" as names. Keep the legacy pattern
// above for compatibility with old reports, but use this conservative list
// for new publication candidates.
const STRICT_SURNAME_PATTERN = /[赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元顾孟平黄穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林钟徐邱骆高夏蔡田樊胡凌霍虞万柯管卢莫经房裘缪解应宗丁宣邓郁单杭洪包诸左石崔吉龚程嵇邢滑裴陆荣翁荀羊惠甄封芮羿储靳汲松井段富巫乌焦巴弓牧车侯全郗班仰秋仲伊宫宁仇栾暴甘厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟印宿白怀蒲从鄂索咸赖卓蔺屠蒙池乔胥能苍双党翟谭贡姬申扶堵冉宰桑桂濮牛寿通边扈燕冀浦尚农温庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越隆师巩聂晁勾敖融冷辛那简饶空曾毋养鞠须丰巢关蒯相查荆红游竺权逯盖益桓公]/u;
  const COMMON_TERMS = new Set('他 她 他们 她们 它 它们 人物 人形 人影 人手 人群 人声 人脸 人身 人心 人格 身形 身影 身上 手里 眼睛 脸上 男子 男生 女子 女生 女人 男人 少年 少女 老人 孩子 青年 兄弟 姐姐 哥哥 妈妈 父亲 母亲 师兄 师姐 师父 老师 先生 小姐 公子 姑娘 众人 所有人 时候 事情 问题 应付'.split(/\s+/));
// 常见普通词和职务短语不作为匿名化人名，避免把正常描写替换成占位符。
['双颊', '东西', '那人', '石子', '高专内', '余光', '成功', '武侠', '都市', '简单', '从前', '向床边', '步子', '宿舍门', '解释', '厉害', '相互', '周围', '经历', '于面前', '强笑道', '张记者', '左护法', '余韵', '明白么', '华山派', '向周围', '那棵树', '那两', '张椅子', '物色', '那天', '平常光', '钱夹', '严肃', '祖宗', '白痴', '马达', '能安神', '成天挨', '左侧敞', '明明知', '何志没', '沈母没', '郁年拆', '那股力'].forEach(term => COMMON_TERMS.add(term));
// 常用词白名单：这些词禁止进入 forbiddenTerms、禁止被替换为人名占位符
// （至少包含手册指定的 温暖、平静、冷静、大哥、项目、曾经、宿舍、强硬、冷笑、严厉、都能、都要）
const WHITELIST = new Set('温暖 平静 冷静 大哥 项目 曾经 宿舍 强硬 冷笑 严厉 都能 都要 温柔 悲伤 快乐 愤怒 紧张 轻松 沉重 疲惫 兴奋 失望 期待 恐惧 安心 慌张 羞涩 尴尬 无奈 孤独 寂寞 烦躁 郁闷 惆怅 欣慰 欢喜 惊喜 苦涩 酸楚 麻木 释然 坦然 从容 焦躁 惶恐 懊恼 悔恨 嫉妒 羡慕 怜悯 同情 感动 震撼 敬畏 崇敬 轻蔑 鄙夷 厌恶 憎恨 恐慌 颤栗 战栗 窒息 揪心 心痛 心碎 心动 心安 心慌 心虚 心烦 心寒 心宽 心软 心狠 安静 沉默 清醒 糊涂 明白 清楚 模糊 精神 憔悴 苍白 红润 干瘦 肥胖 健壮 虚弱 强壮 瘦弱 高大 矮小 难受 舒服 安逸 悠闲 匆忙 仓促 急促 缓慢 平稳 动荡 安宁 喧嚣 寂静 热闹 冷清 看见 听见 觉得 认为 知道 懂得 忘记 记得 想起 思念 怀念 盼望 等待 寻找 发现 消失 出现 离开 返回 进入 退出 开始 结束 继续 停止 前进 后退 上升 下降 打开 关闭 拿起 放下 推开 拉开 站起 坐下 躺下 站 坐 卧 蹲 跪 趴 跑 跳 爬 飞 游 冲 撞 碰 摸 拍 打 踢 踩 指 点 摇 摆 晃 扭 弯 伸 缩 举 托 抱 拥 拉 拖 搬 抬 扛 背 挑 提 抓 握 捏 掐 拧 挤 压 按 揉 搓 抚 擦 洗 刷 扫 写 画 读 念 唱 喊 叫 哭 叹 哼 骂 劝 夸 赞 贬 评 论 议 讲 谈 聊 教 学 练 习 研 究 思 考 想 念 忆 梦 猜 估 计 算 量 数 查 验 试 验 测 比 赛 赢 输 争 斗 战 抗 守 攻 防 护 救 帮 助 扶 持 撑 挺 计划 方案 问题 事情 原因 结果 过程 时间 时候 地点 地方 环境 情况 状况 条件 要求 标准 规则 制度 方法 方式 手段 工具 设备 机器 系统 网络 数据 信息 消息 新闻 故事 小说 文章 诗歌 音乐 歌曲 电影 电视 游戏 比赛 考试 学习 工作 事业 职业 行业 公司 企业 学校 医院 银行 商店 市场 价格 价值 利益 成本 收入 支出 利润 工资 奖金 财富 金钱 资源 能源 材料 物质 身体 头脑 心脏 血液 骨骼 肌肉 皮肤 神经 眼睛 耳朵 鼻子 嘴巴 牙齿 舌头 喉咙 肩膀 手臂 手指 手掌 拳头 胸口 腹部 腰部 腿部 膝盖 已经 正在 将要 刚才 现在 目前 将来 过去 永远 暂时 偶尔 常常 经常 总是 从不 根本 完全 彻底 实在 确实 大概 也许 可能 一定 必然 未必 似乎 仿佛 好像 犹如 如同 比如 例如 尤其 特别 格外 十分 非常 相当 比较 稍微 略微 渐渐 逐渐 慢慢 忽然 突然 猛然 骤然 依然 依旧 仍然 居然 竟然 果然 固然 虽然 但是 可是 不过 然而 而且 并且 以及 或者 因为 所以 由于 因此 因而 如果 假如 倘若 若是 只要 只有 除非 无论 不论 尽管 即使 哪怕 与其 不如 宁可 尚且 况且 何况 乃至 甚至 不仅 不但 不光 除了 此外 另外 相反 否则 于是 接着 然后 随后 最后 终于 起初 首先 其次 再次 我们 你们 他们 她们 它们 大家 彼此 各自 自己 自我 本身 什么 怎样 怎么 如何 为何 哪里 哪儿 谁 这 那 此 该 每 各 某 任何 一切 全部 所有 部分 一些 有的 其余 其他 别的 天空 大地 海洋 河流 山川 森林 草原 沙漠 雪 雨 风 云 雷 电 冰 霜 露 雾 火 水 土 石 沙 泥 花 草 树 木 叶 根 枝 果 种 苗 虫 鱼 鸟 兽 家畜 家禽 马 牛 羊 猪 狗 猫 鸡 鸭 鹅 朋友 敌人 亲人 家人 同学 同事 邻居 伙伴 对手 盟友 主人 客人 老师 学生 医生 护士 律师 警察 士兵 将军 皇帝 国王 总统 部长 经理 老板 员工 工人 农民 商人 顾客 乘客 观众 听众 读者 作者 编者 译者 演员 歌手 导演 作家 诗人 画家 书法家 科学家 工程师 技师 师傅 徒弟 师兄 师弟 师姐 师妹 学长 学弟 学姐 学妹 父亲 母亲 儿子 女儿 兄弟 姐妹 哥哥 弟弟 姐姐 妹妹 丈夫 妻子 爷爷 奶奶 外公 外婆 舅舅 姨妈 姑妈 叔叔 伯伯 侄子 侄女 外甥 表哥 表弟 表姐 表妹 孙子 孙女 正确 错误 真实 虚假 真假 对错 好坏 善恶 美丑 黑白 高低 长短 大小 多少 远近 深浅 厚薄 轻重 快慢 早晚 新旧 明暗 冷热 干湿 软硬 松紧 宽窄 粗细 曲直 圆方 正斜 横竖 是非 可否 能否'.split(/\s+/));
const NAME_STOP_CHARS = /[的地得着了过在会将被很还也又就便而把让从向对跟为与和心手头脸身口形影物群声色事时里外中上下多少第一于以肤]/u;
const COMMON_NAME_PREFIXES = Object.freeze(['那么', '那枚', '一枚', '这个', '那个', '什么', '哪里', '如何', '怎么', '其实', '已经', '正在', '可以', '可能', '应该', '能够', '就是', '因为', '所以', '居然', '虽然', '果然', '当然', '突然', '然后', '然而', '既然', '从来', '巴掌', '能收', '容变']);
const NAME_COMPOUND_CONTEXT_PATTERN = /^(实习|生于|生在|出生|就读|毕业|来自|任职|担任|曾任|现任|所在|进入|加入|属于|拥有|具有)/u;
const NAME_DISCOURSE_CONTEXT_PATTERN = /^(虽|但|却|然|如|若|即|并)/u;
// 给定名末字黑名单：人名末字几乎不会是动词/助词/代词/功能字；命中即非人名，避免把
// "利落""拎""觉"等常见词误判为人名后产生 "[人物]地"/"一[人物]下" 等破碎模式
const NON_GIVEN_NAME_TAIL = /[的说道问道看望盯瞥抬起低垂握抓捏咬笑哭走跑退进靠转停开坐躲挡拦劝骂喊叫答应察觉发现觉得开始继续突然死眯沉抱拿接推带钻想见伸激打扎了落地得着过吗呢吧啊呀哦喂哼啦喽哩给被把将从向对跟为与和同让于由按比及或若乃连则却但是因由因为所以然而可是不过而且并且也或由于因此因而如果假如倘若若是只要只有除非无论不论尽管即使哪怕与其不如宁可尚且况且何况乃至甚至不仅不但除了此外另外相反否则于是接着然后随后最后终于起初首先其次再次你我他她它们我这那此其之哪个哪些谁什么怎样怎么如何为何哪里哪儿咋每各某任何一切全部所有部分一些有的其余其他别的很太最极颇愈越渐稍略必务请谢]/u;

const ARCHETYPE_HINTS = {
  '豪爽侠义型': '动作直接、关系表达外放，愿意为承诺承担看得见的代价',
  '冷静理智型': '先观察限制和证据，再用克制的动作争取选择空间',
  '温柔内敛型': '情绪藏在照料、退让和不完整的话语里，但关键处会作出明确选择',
  '活泼开朗型': '用轻快的反应和主动靠近调节关系，同时保留对风险的即时感知',
  '阴郁腹黑型': '信息不一次说尽，让试探、延迟和代价体现人物的防备与算计',
  '霸道强势型': '通过占据位置、下达要求和承担后果建立控制感，而不是只靠宣告强大',
  '天真烂漫型': '从直接感受和具体好奇出发，让误解与真诚共同推动选择',
  '市侩圆滑型': '优先衡量利益、风险和关系成本，语言留有可转圜的余地',
  '高傲冷峻型': '减少无效解释，以距离、筛选和精准反应表现自我边界',
  '热血冲动型': '压力先转化成身体和行动，冲动必须带来收获、损失或新的限制'
};

const DIMENSION_RULES = {
  appearance: ['外貌只保留会影响当前判断、关系或行动的细节。', '用姿态、衣着状态和环境反应呈现类型，不写静态清单。'],
  expression: ['神态通过视线、停顿、呼吸和面部变化落地。', '情绪不要在动作后再次用标签解释，留出读者推断空间。'],
  action: ['动作必须带有选择、阻力或结果。', '让动作推进关系和冲突，不用性格标签替代行为。'],
  dialogue: ['对白围绕即时目的展开，保留省略、打断、称呼和不愿说出的部分。', '每句话至少争取信息、关系、时间或位置中的一项。'],
  catchphrase: ['口头禅只能作为稳定倾向，必须随关系和压力发生轻微变化。', '不要让一个高频词代替完整的人物声音。'],
  psychology: ['心理保留人物当下能意识到的片段和选择依据。', '省略显而易见的完整因果链，用感官、记忆碎片或未完成念头逼近行动。']
};

/** 为正式建库配置资源库和原书根目录，开启最终证据文件回读校验。
 * 参数：config 为已通过结构校验的配额配置；enabled 表示是否启用严格回读。
 * 返回值：供候选抽取、归档门禁和画像统计共同使用的建库配置。
 */
function prepareBuildQuotaConfig(config, enabled = false) {
  const value = config && typeof config === 'object' ? config : {};
  if (!enabled && value.revalidateArchiveEvidence !== true) return value;
  return {
    ...value,
    revalidateArchiveEvidence: true,
    resourceRoot: RESOURCE_ROOT,
    archiveRoot: path.join(RESOURCE_ROOT, '小说原本')
  };
}

/** Read command-line options for the deterministic index build. */
function readOptions(argv) {
  const options = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    markdownOutput: DEFAULT_MARKDOWN_OUTPUT,
    sources: DEFAULT_SOURCES,
    archiveManifest: DEFAULT_ARCHIVE_MANIFEST,
    quotaConfig: DEFAULT_QUOTA_CONFIG,
    intermediate: DEFAULT_INTERMEDIATE,
    force: false,
    classificationReview: '',
    approve: false,
    auditFile: ''
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--input') options.input = path.resolve(argv[++index]);
    else if (value === '--output') options.output = path.resolve(argv[++index]);
    else if (value === '--markdown-output') options.markdownOutput = path.resolve(argv[++index]);
    else if (value === '--sources') options.sources = path.resolve(argv[++index]);
    else if (value === '--archive-manifest') options.archiveManifest = path.resolve(argv[++index]);
    else if (value === '--quota-config') options.quotaConfig = path.resolve(argv[++index]);
    else if (value === '--intermediate') options.intermediate = path.resolve(argv[++index]);
    else if (value === '--force') options.force = true;
    else if (value === '--classification-review') options.classificationReview = path.resolve(argv[++index]);
    else if (value === '--approve') options.approve = true;
    else if (value === '--audit-file') options.auditFile = path.resolve(argv[++index]);
  }
  return options;
}

/** 将发布样本的本地回读元数据渲染为可审计的 Markdown 行，不输出原书正文。
 * 参数：sample 为已通过发布门禁的匿名样本。
 * 返回值：包含样本、作品、章节、偏移和哈希字段的 Markdown 行数组。
 */
function renderPublishedSampleProvenance(sample) {
  const source = sample && typeof sample === 'object' ? sample : {};
  const provenance = source.provenance && typeof source.provenance === 'object' ? source.provenance : {};
  const occurrences = Array.isArray(source.occurrences) && source.occurrences.length
    ? source.occurrences
    : [provenance];
  const value = (input, fallback = '未记录') => {
    const text = String(input ?? '').replace(/[\r\n]+/gu, ' ').trim();
    return text || fallback;
  };
  const occurrenceLabel = occurrence => [
    `章节${value(occurrence.chapterId)}`,
    `${value(occurrence.startOffset)}-${value(occurrence.endOffset)}`
  ].join('@');
  const lines = [
    `> 样本ID：${value(source.id)}；作品ID：${value(source.canonicalWorkId || source.sourceWorkId)}；归档文件：${value(provenance.sourceFilePath)}`,
    `> 章节ID：${value(provenance.chapterId)}；章节标题：${value(provenance.chapterTitle)}；章节URL：${value(provenance.chapterUrl)}`,
    `> 原文偏移：${value(provenance.startOffset)}-${value(provenance.endOffset)}（${value(provenance.offsetUnit)}）；候选文本 SHA-256：${value(provenance.candidateTextSha256)}；原书文件 SHA-256：${value(provenance.sourceContentHash)}`
  ];
  if (occurrences.length > 1) lines.push(`> 其他回读位置：${occurrences.slice(1).map(occurrenceLabel).join('；')}`);
  return lines;
}

/** 将已经通过发布门禁的匿名样本导出为按类型和描写维度分组的 Markdown。
 * 参数：index 为建库结果索引；report 为质量报告。
 * 返回值：写入的 Markdown 字符串；没有已发布样本时仍输出明确的空库状态。
 */
function renderPublishedMarkdown(index, report) {
  const released = index?.markdownPublished === true;
  const samples = [
    ...(released && Array.isArray(index?.general?.samples) ? index.general.samples : []),
    ...(released && Array.isArray(index?.mature?.samples) ? index.mature.samples : [])
  ];
  const lines = [
    '# 人物描写素材库（发布版）',
    '',
    `> 版本：${VERSION}；发布状态：${released ? '已发布' : '未发布'}。`,
    '> 本文件只收录通过机器门禁、匿名化和人工审批的真实样本；未发布时不输出任何原文样本。',
    `> 统计来源哈希：${String(index?.sourceHash || report?.sourceHash || '').slice(0, 16) || '未生成'}。`,
    ''
  ];
  if (!samples.length) {
    const reasons = Array.isArray(report?.publicationGate?.reasons) ? report.publicationGate.reasons.join('、') : '';
    lines.push('## 当前状态', '', `当前没有已发布样本。请先完成归档归属、质量门禁和人工审批${reasons ? `；当前未通过：${reasons}` : ''}。`, '');
    return lines.join('\n');
  }
  const grouped = new Map();
  for (const sample of samples) {
    const key = `${sample.archetype || '未分类'}|${publicationGenreLabel(sample)}|${sample.dimension || 'psychology'}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(sample);
  }
  const archetypes = [...new Set(samples.map(sample => sample.archetype || '未分类'))];
  for (const archetype of archetypes) {
    lines.push(`## ${archetype}`, '');
    const buckets = [...new Set(samples
      .filter(sample => (sample.archetype || '未分类') === archetype)
      .map(sample => publicationGenreLabel(sample)))];
    for (const bucket of buckets) {
      lines.push(`### ${bucket}`, '');
      for (const [dimension, label] of DIMENSIONS) {
        const rows = grouped.get(`${archetype}|${bucket}|${dimension}`) || [];
        if (!rows.length) continue;
        lines.push(`#### ${label}`, '');
        rows.forEach((sample, index) => {
          const rawGenres = Array.isArray(sample.rawGenres) && sample.rawGenres.length
            ? sample.rawGenres.join('、')
            : sample.genre || '未标注';
          lines.push(`**${index + 1}. ${sample.sourceWorkId || sample.sourceHash || '匿名作品'}**`);
          lines.push(`> 来源哈希：${sample.sourceHash || '无'}；原题材：${rawGenres}；题材桶：${sample.genreBucket || '未映射题材'}；平台：${sample.platform || '未标注'}`);
          lines.push(...renderPublishedSampleProvenance(sample));
          lines.push(`> ${sample.text}`, '');
        });
      }
    }
  }
  return lines.join('\n');
}

/** 只从公开字段读取标量，避免把内部对象或证据结构带入发布 Markdown。 */
function publicReleaseScalar(value) {
  if (!['string', 'number', 'boolean'].includes(typeof value)) return '';
  return String(value).replace(/[\r\n]+/gu, ' ').trim();
}

/** 只保留公开标签列表中的标量值，并去重。 */
function publicReleaseList(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(publicReleaseScalar).filter(Boolean))];
}

/** 将公开标题中的 Markdown 控制字符去掉，防止标签内容改变文档结构。 */
function publicReleaseHeading(value, fallback) {
  return publicReleaseScalar(value).replace(/^#+/u, '').trim() || fallback;
}

/** 读取统计数值；发布版不输出未知对象或字符串化的内部诊断。 */
function publicReleaseMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function publicReleaseCollection(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([key, item]) => (
    item && typeof item === 'object' && !Array.isArray(item) ? { ...item, key: item.key || key } : { id: key, value: item }
  ));
}

function publicReleaseContainers(index) {
  return [index, index?.general, index?.mature, index?.publicData]
    .filter(value => value && typeof value === 'object');
}

function publicReleaseSampleField(sample, field) {
  const nested = sample?.sample && typeof sample.sample === 'object' ? sample.sample : {};
  return sample?.[field] ?? nested[field] ?? '';
}

function publicReleaseArchetype(sample) {
  const direct = publicReleaseScalar(sample?.archetype);
  if (direct) return direct;
  const archetype = sample?.archetype && typeof sample.archetype === 'object' ? sample.archetype : {};
  return publicReleaseScalar(archetype.primaryArchetype || archetype.archetype);
}

function publicReleaseSampleText(sample) {
  const nested = sample?.sample && typeof sample.sample === 'object' ? sample.sample : {};
  return publicReleaseScalar(sample?.safeText)
    || publicReleaseScalar(nested.safeText)
    || publicReleaseScalar(sample?.text);
}

function collectPublicReleaseSamples(index) {
  const samples = [];
  for (const container of publicReleaseContainers(index)) {
    if (Array.isArray(container.samples)) samples.push(...container.samples);
  }
  return samples.filter(sample => sample && typeof sample === 'object' && publicReleaseSampleText(sample));
}

function collectPublicReleaseRules(index) {
  const rules = [];
  for (const container of publicReleaseContainers(index)) {
    if (Array.isArray(container.rules)) rules.push(...container.rules);
  }
  const seen = new Set();
  return rules.filter(rule => {
    if (!rule || typeof rule !== 'object') return false;
    const key = publicReleaseScalar(rule.id)
      || `${publicReleaseScalar(rule.archetype)}|${publicReleaseScalar(rule.dimension)}|${publicReleaseScalar(rule.rule)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectPublicReleaseMicroPatterns(index, samples) {
  const patterns = [];
  for (const container of publicReleaseContainers(index)) {
    patterns.push(...publicReleaseCollection(container.microPatterns));
    patterns.push(...publicReleaseCollection(container.microPattern));
  }
  for (const sample of samples) {
    const nested = sample.sample && typeof sample.sample === 'object' ? sample.sample : {};
    patterns.push(...publicReleaseCollection(sample.microPatternDetails));
    patterns.push(...publicReleaseCollection(nested.microPatternDetails));
  }
  const seen = new Set();
  return patterns.filter(pattern => {
    if (!pattern || typeof pattern !== 'object') return false;
    const id = publicReleaseScalar(pattern.id || pattern.patternId);
    const key = id || [
      publicReleaseScalar(pattern.dimension),
      publicReleaseList(pattern.scene || pattern.scenes).join(','),
      publicReleaseList(pattern.relationship || pattern.relationships).join(','),
      publicReleaseScalar(pattern.pattern || pattern.description)
    ].join('|');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectPublicReleaseAntiPatterns(index, samples) {
  const antiPatterns = [];
  for (const container of publicReleaseContainers(index)) {
    antiPatterns.push(...publicReleaseCollection(container.antiPatterns));
    antiPatterns.push(...publicReleaseCollection(container.antiPattern));
  }
  for (const sample of samples) {
    const nested = sample.sample && typeof sample.sample === 'object' ? sample.sample : {};
    antiPatterns.push(...publicReleaseCollection(sample.antiPatterns));
    antiPatterns.push(...publicReleaseCollection(nested.antiPatterns));
  }
  const seen = new Set();
  return antiPatterns.map((value, index) => {
    if (typeof value === 'string' || typeof value === 'number') {
      return { id: `ap-${String(index + 1).padStart(3, '0')}`, antiPattern: publicReleaseScalar(value) };
    }
    if (!value || typeof value !== 'object') return null;
    return {
      id: publicReleaseScalar(value.id || value.patternId) || `ap-${String(index + 1).padStart(3, '0')}`,
      antiPattern: publicReleaseScalar(value.antiPattern || value.description || value.rule),
      sampleCount: publicReleaseMetric(value.sampleCount)
    };
  }).filter(item => {
    if (!item?.antiPattern) return false;
    const key = `${item.id}|${item.antiPattern}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function publicReleaseReferences(value) {
  return publicReleaseCollection(value).map(item => {
    if (typeof item === 'string' || typeof item === 'number') return publicReleaseScalar(item);
    return publicReleaseScalar(item?.id || item?.patternId || item?.key);
  }).filter(Boolean);
}

function renderPublicReleaseRule(lines, rule, index) {
  const id = publicReleaseHeading(rule.id, `rule-${String(index + 1).padStart(3, '0')}`);
  const archetype = publicReleaseScalar(rule.archetype);
  const dimension = publicReleaseScalar(rule.dimension);
  const scenes = publicReleaseList(rule.scene || rule.scenes);
  const relationships = publicReleaseList(rule.relationship || rule.relationships);
  const signals = publicReleaseList(rule.signals);
  const microPatterns = publicReleaseReferences(rule.microPatterns || rule.microPatternIds || rule.microPattern);
  const antiPatterns = publicReleaseReferences(rule.antiPatterns || rule.antiPatternIds || rule.antiPattern);
  lines.push(`### ${id}`, '');
  if (archetype) lines.push(`- 人物类型：${archetype}`);
  if (dimension) lines.push(`- 描写维度：${dimension}`);
  if (scenes.length) lines.push(`- 使用场景：${scenes.join('、')}`);
  if (relationships.length) lines.push(`- 关系：${relationships.join('、')}`);
  if (signals.length) lines.push(`- 信号：${signals.join('、')}`);
  if (publicReleaseScalar(rule.rule)) lines.push(`- Rule：${publicReleaseScalar(rule.rule)}`);
  if (publicReleaseScalar(rule.application)) lines.push(`- Application：${publicReleaseScalar(rule.application)}`);
  if (publicReleaseScalar(rule.caution)) lines.push(`- Caution：${publicReleaseScalar(rule.caution)}`);
  if (microPatterns.length) lines.push(`- MicroPattern：${microPatterns.join('、')}`);
  if (antiPatterns.length) lines.push(`- AntiPattern：${antiPatterns.join('、')}`);
  lines.push('');
}

function renderPublicReleaseMicroPattern(lines, pattern, index) {
  const id = publicReleaseHeading(pattern.id || pattern.patternId, `mp-${String(index + 1).padStart(3, '0')}`);
  const dimension = publicReleaseScalar(pattern.dimension);
  const scenes = publicReleaseList(pattern.scene || pattern.scenes);
  const relationships = publicReleaseList(pattern.relationship || pattern.relationships);
  const signals = publicReleaseList(pattern.signals);
  const steps = publicReleaseList(pattern.pattern || pattern.steps || pattern.sequence);
  const mechanism = publicReleaseScalar(pattern.mechanism || pattern.description);
  const antiPattern = publicReleaseScalar(pattern.antiPattern || pattern.caution);
  lines.push(`### ${id}`, '');
  if (dimension) lines.push(`- 描写维度：${dimension}`);
  if (scenes.length) lines.push(`- 场景：${scenes.join('、')}`);
  if (relationships.length) lines.push(`- 关系：${relationships.join('、')}`);
  if (signals.length) lines.push(`- 信号：${signals.join('、')}`);
  if (steps.length) lines.push(`- 结构步骤：${steps.join(' → ')}`);
  if (mechanism) lines.push(`- 机制：${mechanism}`);
  if (antiPattern) lines.push(`- 反模式提示：${antiPattern}`);
  if (publicReleaseMetric(pattern.sampleCount) !== null) lines.push(`- 样本数：${publicReleaseMetric(pattern.sampleCount)}`);
  lines.push('');
}

function renderPublicReleaseAntiPattern(lines, antiPattern, index) {
  const id = publicReleaseHeading(antiPattern.id, `ap-${String(index + 1).padStart(3, '0')}`);
  lines.push(`### ${id}`, '', `- AntiPattern：${publicReleaseScalar(antiPattern.antiPattern)}`);
  if (publicReleaseMetric(antiPattern.sampleCount) !== null) lines.push(`- 样本数：${publicReleaseMetric(antiPattern.sampleCount)}`);
  lines.push('');
}

function renderPublicReleaseSample(lines, sample, index) {
  const archetype = publicReleaseArchetype(sample);
  const dimension = publicReleaseScalar(publicReleaseSampleField(sample, 'dimension'));
  const genreBucket = publicReleaseScalar(publicReleaseSampleField(sample, 'genreBucket'))
    || publicReleaseScalar(publicReleaseSampleField(sample, 'primaryGenre'))
    || publicReleaseScalar(publicReleaseSampleField(sample, 'genre'));
  lines.push(`### Sample ${index + 1}`, '');
  if (archetype) lines.push(`- 人物类型：${archetype}`);
  if (dimension) lines.push(`- 描写维度：${dimension}`);
  if (genreBucket) lines.push(`- 题材桶：${genreBucket}`);
  lines.push(`- safeText：${publicReleaseSampleText(sample)}`, '');
}

function renderPublicReleaseProfile(lines, profile, key, index) {
  const profileKey = publicReleaseHeading(profile?.key || key, `profile-${String(index + 1).padStart(3, '0')}`);
  lines.push(`### ${profileKey}`, '');
  const state = profile?.reliable === true ? '可靠' : profile?.available === true ? '可用' : '待补充';
  lines.push(`- 状态：${state}`);
  const metrics = [
    ['样本数', profile?.sampleCount], ['字数', profile?.charCount], ['句子数', profile?.sentenceCount],
    ['平均句长', profile?.sentenceMean], ['句长标准差', profile?.sentenceStd],
    ['短句比例', profile?.shortSentenceRatio], ['长句比例', profile?.longSentenceRatio],
    ['平均逗号数', profile?.commaPerSentence], ['停顿符号密度', profile?.ellipsisPerKilo],
    ['四字结构密度', profile?.fourCharStructurePerKilo], ['量词密度', profile?.measureWordPerKilo],
    ['长无标点段落比例', profile?.noPunctuationLongRatio], ['单句段落比例', profile?.singleSentenceParaRatio],
    ['对话段落比例', profile?.dialogueRowRatio], ['叙述对话交替度', profile?.dialogueNarrationAlternation],
    ['作品数', profile?.sourceWorkCount], ['维度数', profile?.dimensionCount], ['平台数', profile?.platformCount]
  ];
  for (const [label, value] of metrics) {
    const metric = publicReleaseMetric(value);
    if (metric !== null) lines.push(`- ${label}：${metric}`);
  }
  const dimensionCoverage = profile?.dimensionCoverage && typeof profile.dimensionCoverage === 'object'
    ? profile.dimensionCoverage
    : {};
  for (const [dimension, label] of DIMENSIONS) {
    const metric = publicReleaseMetric(dimensionCoverage[dimension]);
    if (metric !== null) lines.push(`- ${label}覆盖字数：${metric}`);
  }
  const semanticFields = [
    ['常见场景', profile?.commonScenes || profile?.scenes],
    ['常见关系', profile?.commonRelationships || profile?.relationships],
    ['常见潜台词', profile?.commonSubtexts || profile?.subtexts],
    ['常见人类纹理', profile?.commonHumanTextures || profile?.humanTextures],
    ['常见 MicroPattern', profile?.commonMicroPatterns || profile?.microPatterns],
    ['常见 AntiPattern', profile?.commonAntiPatterns || profile?.antiPatterns]
  ];
  for (const [label, value] of semanticFields) {
    const list = publicReleaseList(value);
    if (list.length) lines.push(`- ${label}：${list.join('、')}`);
  }
  if (publicReleaseScalar(profile?.basis)) lines.push(`- 统计口径：${publicReleaseScalar(profile.basis)}`);
  lines.push('');
}

/** Stage 73：发布版只输出规则、模式、匿名化样本、画像摘要和统计。
 * 该函数使用显式白名单，不读取 rawText、证据、来源身份、哈希或完整禁词字段。
 */
function renderPublicReleaseMarkdown(index, report) {
  const source = index && typeof index === 'object' ? index : {};
  const released = source.markdownPublished === true;
  const samples = released ? collectPublicReleaseSamples(source) : [];
  const rules = released ? collectPublicReleaseRules(source) : [];
  const microPatterns = released ? collectPublicReleaseMicroPatterns(source, samples) : [];
  const antiPatterns = released ? collectPublicReleaseAntiPatterns(source, samples) : [];
  const profiles = released && source.profilesPublished !== false
    ? publicReleaseCollection(source.profiles || source.publicData?.profiles)
    : [];
  const lines = [
    '# 人物描写素材库（发布版）',
    '',
    `> 版本：${VERSION}；发布状态：${released ? '已发布' : '未发布'}。`,
    '> 本文件仅包含 Rule、MicroPattern、AntiPattern、匿名化 Sample、Profile 摘要和统计。',
    ''
  ];
  if (!released) lines.push('## 当前状态', '', '当前没有已发布内容。', '');
  if (rules.length) {
    lines.push('## Rules', '');
    rules.forEach((rule, index) => renderPublicReleaseRule(lines, rule, index));
  }
  if (microPatterns.length) {
    lines.push('## MicroPatterns', '');
    microPatterns.forEach((pattern, index) => renderPublicReleaseMicroPattern(lines, pattern, index));
  }
  if (antiPatterns.length) {
    lines.push('## AntiPatterns', '');
    antiPatterns.forEach((antiPattern, index) => renderPublicReleaseAntiPattern(lines, antiPattern, index));
  }
  if (samples.length) {
    lines.push('## Samples', '');
    samples.forEach((sample, index) => renderPublicReleaseSample(lines, sample, index));
  }
  if (profiles.length) {
    lines.push('## Profiles', '');
    profiles.forEach((entry, index) => {
      const profile = entry && typeof entry === 'object' ? entry : {};
      renderPublicReleaseProfile(lines, profile, profile.key, index);
    });
  }
  const counts = report?.counts && typeof report.counts === 'object' ? report.counts : {};
  const profileReport = report?.profiles && typeof report.profiles === 'object' ? report.profiles : {};
  const statistics = [
    ['规则数', rules.length], ['MicroPattern 数', microPatterns.length], ['AntiPattern 数', antiPatterns.length],
    ['匿名化 Sample 数', samples.length], ['Profile 数', profiles.length],
    ['发布样本数', counts.published], ['发布样本字数', counts.markdownPublishedChars],
    ['候选样本字数', counts.publicationCandidateChars], ['画像唯一样本数', profileReport.uniqueSamples],
    ['画像统计字数', profileReport.uniqueChars], ['可靠 Profile 数', profileReport.reliableCount]
  ];
  lines.push('## 统计', '');
  for (const [label, value] of statistics) {
    const metric = publicReleaseMetric(value);
    if (metric !== null) lines.push(`- ${label}：${metric}`);
  }
  lines.push(`- profilesPublished：${source.profilesPublished === true ? 'true' : 'false'}`, '');
  return lines.join('\n');
}

/**
 * 读取可选 JSON 文件，损坏或不存在时返回调用方提供的默认值。
 * 参数：filePath 为 JSON 文件路径；fallback 为失败时的默认值。
 * 返回值：解析后的 JSON 值或 fallback。
 */
function readOptionalJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

/** 选择发布 Markdown 的原题材分组标签，优先使用唯一主归属以避免多题材作品重复充当配额。
 * 参数：sample 为已规范化发布样本。
 * 返回值：用于 Markdown 三级标题的原题材或聚合桶名称。
 */
function publicationGenreLabel(sample) {
  const source = sample && typeof sample === 'object' ? sample : {};
  const rawGenres = Array.isArray(source.rawGenres) ? source.rawGenres.filter(Boolean) : [];
  return String(source.primaryGenre || (rawGenres.length === 1 ? rawGenres[0] : '') || source.genreBucket || '未映射题材').trim();
}

/** 规范化原书标题，供样本行和 manifest 的保守归属匹配使用。
 * 参数：value 为作品标题或归档文件名。
 * 返回值：去掉书名包装、分卷标记和空白后的标题。
 */
function normalizeArchiveTitle(value) {
  return String(value || '')
    .replace(/\.txt$/iu, '')
    .replace(/^《|》$/gu, '')
    .replace(/^\d+[-_]/u, '')
    .replace(/[【\[].*?(搜|笔趣|www\.).*?[】\]]/giu, '')
    .replace(/\s*[(（][^)]*(?:章|卷|部|集|篇|回)[^)]*[)）]\s*$/u, '')
    .replace(/\s+/gu, '')
    .trim();
}

/** 建立 manifest 原书归档索引，区分可用、排除和未归属作品。
 * 参数：manifest 为原书 manifest 对象，可为空。
 * 返回值：包含可匹配键和归档记录的索引对象。
 */
function buildArchiveEligibilityIndex(manifest) {
  const books = Array.isArray(manifest?.books) ? manifest.books : [];
  const byKey = new Map();
  const byFilePath = new Map();
  const add = (key, book) => {
    if (!key || key.endsWith(':')) return;
    if (!byKey.has(key)) {
      byKey.set(key, book);
      return;
    }
    if (byKey.get(key) !== book) byKey.set(key, null);
  };
  const addFilePath = (filePath, book, record) => {
    const normalizedPath = String(filePath || '').replace(/\\/gu, '/').replace(/^\.\//u, '');
    if (!normalizedPath) return;
    if (!byFilePath.has(normalizedPath)) {
      byFilePath.set(normalizedPath, { book, record });
      return;
    }
    if (byFilePath.get(normalizedPath)?.book !== book) byFilePath.set(normalizedPath, null);
  };
  for (const book of books) {
    const parts = Array.isArray(book.parts) ? book.parts : [];
    const records = [book, ...parts];
    for (const record of records) {
      add(`canonical:${String(record.canonicalWorkId || '').trim()}`, book);
      add(`work:${String(record.sourceWorkId || '').trim()}`, book);
      add(`novel:${String(record.sourceNovelId || '').trim()}`, book);
      add(`url:${canonicalizeSourceUrl(record.sourceUrl || '')}`, book);
      add(`title:${normalizeArchiveTitle(record.title || record.originalFileName)}`, book);
      addFilePath(record.filePath, book, record);
    }
  }
  return { available: Array.isArray(manifest?.books), books, byKey, byFilePath };
}

/** 将逻辑作品根记录和一个分卷合成为可独立执行门禁的记录，避免根目录快照覆盖分卷证据。
 * 参数：book 为 manifest 逻辑作品；part 为其中一个分卷或根记录。
 * 返回值：继承缺省元数据且不带 parts 嵌套的单分卷记录。
 */
function materializeArchivePartRecord(book, part) {
  const root = book && typeof book === 'object' ? book : {};
  const sourcePart = part && typeof part === 'object' ? part : root;
  const { parts: _rootParts, ...rootFields } = root;
  const { parts: _partParts, ...partFields } = sourcePart;
  return {
    ...rootFields,
    ...partFields,
    title: partFields.title || root.title || '',
    author: partFields.author || root.author || '',
    sourceWorkId: partFields.sourceWorkId || root.sourceWorkId || '',
    canonicalWorkId: partFields.canonicalWorkId || root.canonicalWorkId || '',
    sourceUrl: partFields.sourceUrl || root.sourceUrl || '',
    rawGenres: Array.isArray(partFields.rawGenres) && partFields.rawGenres.length ? partFields.rawGenres : root.rawGenres || [],
    primaryGenre: partFields.primaryGenre || root.primaryGenre || '',
    authorization: Object.keys(partFields.authorization || {}).length ? partFields.authorization : root.authorization || {},
    completionStatus: partFields.completionStatus || root.completionStatus || '',
    completionEvidenceRef: partFields.completionEvidenceRef || root.completionEvidenceRef || '',
    completionEvidenceVerified: partFields.completionEvidenceVerified === true || root.completionEvidenceVerified === true,
    contentScope: partFields.contentScope || root.contentScope || '',
    fullWorkEvidenceRef: partFields.fullWorkEvidenceRef || root.fullWorkEvidenceRef || '',
    fullWorkEvidenceVerified: partFields.fullWorkEvidenceVerified === true || root.fullWorkEvidenceVerified === true,
    expectedChapterCount: partFields.expectedChapterCount || root.expectedChapterCount || 0,
    fetchedChapterCount: partFields.fetchedChapterCount || root.fetchedChapterCount || 0,
    chapterCoverage: partFields.chapterCoverage ?? root.chapterCoverage ?? null,
    contentHash: partFields.contentHash || root.contentHash || '',
    quality: partFields.quality || root.quality || {},
    chapters: Array.isArray(partFields.chapters) ? partFields.chapters : []
  };
}

/** 提取合并逻辑作品自身的质量排除原因，忽略只能在分卷级判断的目录聚合字段。
 * 参数：book 为 manifest 逻辑作品记录。
 * 返回值：逻辑作品级排除原因数组。
 */
function logicalArchiveBookReasons(book) {
  const quality = book?.quality && typeof book.quality === 'object' ? book.quality : {};
  const logicalReasons = new Set(['archive_excluded', 'isFanfiction', 'forumLike', 'incomplete', 'partial', 'missingRanges']);
  const reasons = Array.isArray(quality.reasons) ? quality.reasons.filter(reason => logicalReasons.has(reason)) : [];
  if (book?.excludeFromCorpus === true && !Array.isArray(book?.parts)) reasons.push('archive_excluded');
  if (quality.missingRanges && Array.isArray(quality.missingRanges) && quality.missingRanges.length) reasons.push('missingRanges');
  return [...new Set(reasons)];
}

/** 规范化 manifest 中候选溯源使用的相对文件路径。
 * 参数：value 为资源库内文件路径。
 * 返回值：统一为正斜杠且不带 ./ 前缀的相对路径。
 */
function normalizeArchiveRelativePath(value) {
  return String(value || '').replace(/\\/gu, '/').replace(/^\.\//u, '');
}

/** 审计同名跨平台作品是否都明确绑定到同一个逻辑作品 ID，避免一书多源填充配额。
 * 参数：manifest 为原书 manifest；config 为配额配置。
 * 返回值：包含是否执行、问题列表和可读分组信息的去重审计结果。
 */
function buildCanonicalDedupAudit(manifest, config = {}) {
  const books = Array.isArray(manifest?.books) ? manifest.books : [];
  const groups = new Map();
  for (const book of books) {
    const title = normalizeArchiveTitle(book.title || book.originalFileName);
    if (!title) continue;
    const author = String(book.author || '').replace(/\s+/gu, '').trim();
    const key = `${title}|${author}`;
    if (!groups.has(key)) groups.set(key, []);
    const parts = Array.isArray(book.parts) ? book.parts : [];
    const platforms = new Set([
      book.platform,
      ...(Array.isArray(book.platforms) ? book.platforms : []),
      ...parts.flatMap(part => [part.platform])
    ].map(value => String(value || '').trim()).filter(Boolean));
    const urls = [book.sourceUrl, ...parts.map(part => part.sourceUrl)]
      .map(value => canonicalizeSourceUrl(value || ''))
      .filter(Boolean);
    const hosts = new Set(urls.map(value => {
      try { return new URL(value).hostname.toLowerCase(); } catch (_) { return ''; }
    }).filter(Boolean));
    const platformKeys = platforms.size ? [...platforms] : [...hosts];
    groups.get(key).push({
      id: String(book.id || ''),
      title,
      author,
      sourceWorkIds: [...new Set([book.sourceWorkId, ...parts.map(part => part.sourceWorkId)].map(value => String(value || '').trim()).filter(Boolean))],
      canonicalWorkIds: [...new Set([book.canonicalWorkId, ...parts.map(part => part.canonicalWorkId)].map(value => String(value || '').trim()).filter(Boolean))],
      canonicalWorkIdExplicit: book.canonicalWorkIdExplicit === true || parts.some(part => part.canonicalWorkIdExplicit === true),
      platforms: [...platforms],
      hosts: [...hosts],
      platformKeys
    });
  }
  const issues = [];
  for (const [identityKey, entries] of groups) {
    if (entries.length < 2) continue;
    const platformSet = new Set(entries.flatMap(entry => entry.platformKeys).filter(Boolean));
    const sourceIds = new Set(entries.flatMap(entry => entry.sourceWorkIds));
    const canonicalIds = new Set(entries.flatMap(entry => entry.canonicalWorkIds));
    const explicitCanonicalIds = new Set(entries
      .filter(entry => entry.canonicalWorkIdExplicit)
      .flatMap(entry => entry.canonicalWorkIds));
    if (platformSet.size < 2 || sourceIds.size < 2) continue;
    const reason = explicitCanonicalIds.size > 1
      ? 'canonical_work_id_conflict'
      : explicitCanonicalIds.size === 1 && entries.every(entry => entry.canonicalWorkIdExplicit)
        ? ''
        : 'canonical_work_id_required';
    if (reason) {
      issues.push({
        identityKey,
        title: entries[0].title,
        author: entries[0].author,
        bookIds: entries.map(entry => entry.id).filter(Boolean),
        sourceWorkIds: [...sourceIds],
        canonicalWorkIds: [...canonicalIds],
        platforms: [...platformSet],
        reason
      });
    }
  }
  const enforced = config.rawGenreRequiresDistinctPrimary === true;
  return {
    enforced,
    pass: !enforced || issues.length === 0,
    issueCount: issues.length,
    issues
  };
}

/** 判断一条样本是否来自 manifest 标记的可用原书。
 * 参数：row 为补齐来源字段的样本；archiveIndex 为 buildArchiveEligibilityIndex 结果；config 为配额配置。
 * 返回值：包含 usable、verified 和排除原因的归档资格对象。
 */
function checkArchiveEligibility(row, archiveIndex, config) {
  if (!config.rawGenreRequiresUsableArchive) return { usable: true, verified: false, reason: '' };
  if (!archiveIndex.available) return { usable: false, verified: false, reason: 'archive_manifest_missing' };
  const provenancePath = normalizeArchiveRelativePath(row.provenance?.sourceFilePath);
  const fileRecord = provenancePath ? archiveIndex.byFilePath.get(provenancePath) : null;
  const keys = [
    row.canonicalWorkId ? `canonical:${row.canonicalWorkId}` : '',
    row.sourceWorkId ? `work:${row.sourceWorkId}` : '',
    row.sourceNovelId ? `novel:${row.sourceNovelId}` : '',
    row.sourceUrl ? `url:${canonicalizeSourceUrl(row.sourceUrl)}` : '',
    row.title ? `title:${normalizeArchiveTitle(row.title)}` : ''
  ].filter(Boolean);
  const attributedBook = keys.map(key => archiveIndex.byKey.get(key)).find(Boolean) || null;
  const book = fileRecord?.book || attributedBook;
  if (!book) return { usable: false, verified: false, reason: 'archive_not_attributed' };
  if (fileRecord?.book && attributedBook && fileRecord.book !== attributedBook) {
    return { usable: false, verified: false, reason: 'sample_provenance_work_mismatch', book: fileRecord.book };
  }
  const archiveRecord = materializeArchivePartRecord(book, fileRecord?.record || book);
  const authorization = Object.keys(archiveRecord.authorization || {}).length ? archiveRecord.authorization : row.authorization;
  const eligibility = evaluateArchiveRecord({ ...archiveRecord, authorization }, config || {});
  const logicalReasons = logicalArchiveBookReasons(book);
  if (logicalReasons.length || !isUsableArchiveBook(book, config)) {
    return {
      usable: false,
      verified: true,
      reason: logicalReasons[0] || eligibility.reasons[0] || 'archive_quality_excluded',
      book,
      archiveRecord,
      authorization: eligibility.authorization,
      eligibility
    };
  }
  if (!eligibility.usable) {
    return {
      usable: false,
      verified: true,
      reason: eligibility.reasons[0] || 'archive_quality_excluded',
      book,
      archiveRecord,
      authorization: eligibility.authorization,
      eligibility
    };
  }
  return {
    usable: true,
    verified: true,
    reason: '',
    book,
    archiveRecord,
    authorization: eligibility.authorization,
    eligibility
  };
}

/** 回读单个 occurrence 的本地原书，核验文件、章节、哈希、URL和字符偏移没有漂移。
 * 参数：row 为候选行；provenance 为一条出现位置；archiveIndex 为 manifest 归档索引；config 为配额配置；archiveEligibility 为作品资格结果。
 * 返回值：包含 usable、verified、reason 和实际哈希的单 occurrence 校验结果。
 */
function verifySingleCandidateProvenance(row, provenance, archiveIndex, config = {}, archiveEligibility = null) {
  const sourceFilePath = normalizeArchiveRelativePath(provenance?.sourceFilePath);
  if (!sourceFilePath) return { usable: false, verified: false, reason: 'sample_provenance_missing' };
  const fileRecord = archiveIndex?.byFilePath?.get(sourceFilePath);
  if (!fileRecord || !fileRecord.book || !fileRecord.record) return { usable: false, verified: false, reason: 'sample_provenance_file_unattributed' };
  if (archiveEligibility?.book && archiveEligibility.book !== fileRecord.book) {
    return { usable: false, verified: false, reason: 'sample_provenance_work_mismatch' };
  }
  const root = path.resolve(RESOURCE_ROOT);
  const filePath = path.resolve(root, sourceFilePath);
  const relative = path.relative(root, filePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { usable: false, verified: false, reason: 'sample_provenance_file_outside_root' };
  }
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (_) {
    return { usable: false, verified: false, reason: 'sample_provenance_file_missing' };
  }
  const rawHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const expectedSourceHash = String(provenance.sourceContentHash || '').trim().toLowerCase();
  const declaredSourceHash = String(fileRecord.record.contentHash || fileRecord.book.contentHash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(expectedSourceHash)) {
    return { usable: false, verified: false, reason: 'sample_source_content_hash_missing' };
  }
  if (rawHash !== expectedSourceHash) {
    return { usable: false, verified: false, reason: 'sample_source_content_hash_mismatch', actualSourceContentSha256: rawHash };
  }
  if (declaredSourceHash && (/^[a-f0-9]{64}$/u.test(declaredSourceHash) ? rawHash !== declaredSourceHash : !rawHash.startsWith(declaredSourceHash))) {
    return { usable: false, verified: false, reason: 'archive_manifest_content_hash_mismatch', actualSourceContentSha256: rawHash };
  }
  const text = buffer.toString('utf8').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  const normalizedTextHash = crypto.createHash('sha256').update(text).digest('hex');
  const expectedSourceTextHash = String(provenance.sourceTextHash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(expectedSourceTextHash)) {
    return { usable: false, verified: false, reason: 'sample_source_text_hash_missing' };
  }
  if (normalizedTextHash !== expectedSourceTextHash) {
    return { usable: false, verified: false, reason: 'sample_source_text_hash_mismatch', actualSourceTextSha256: normalizedTextHash };
  }
  const startOffset = Number(provenance.startOffset);
  const endOffset = Number(provenance.endOffset);
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset <= startOffset || endOffset > text.length) {
    return { usable: false, verified: false, reason: 'sample_offset_invalid' };
  }
  const sourceSlice = normalizeSourceText(text.slice(startOffset, endOffset));
  const candidateText = normalizeSourceText(row.text);
  if (!sourceSlice || sourceSlice !== candidateText) {
    return { usable: false, verified: false, reason: 'sample_candidate_text_mismatch' };
  }
  const candidateTextHash = corpusTextHash(candidateText);
  if (String(provenance.candidateTextHash || '').trim().toLowerCase() !== candidateTextHash) {
    return { usable: false, verified: false, reason: 'sample_candidate_text_hash_mismatch' };
  }
  const expectedCandidateSha256 = String(provenance.candidateTextSha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(expectedCandidateSha256)) {
    return { usable: false, verified: false, reason: 'sample_candidate_text_sha256_missing' };
  }
  if (crypto.createHash('sha256').update(candidateText).digest('hex') !== expectedCandidateSha256) {
    return { usable: false, verified: false, reason: 'sample_candidate_text_sha256_mismatch' };
  }
  const chapters = splitChapters(text);
  const chapterIndex = Number(provenance.chapterIndex);
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= chapters.length) {
    return { usable: false, verified: false, reason: 'sample_chapter_index_invalid' };
  }
  const chapter = chapters[chapterIndex];
  const chapterSlice = text.slice(chapter.start, chapter.end);
  const chapterBody = chapter.title === '全文'
    ? chapterSlice
    : chapterSlice.replace(/^[^\r\n]*(?:\r?\n|$)/u, '');
  const chapterTextHash = corpusTextHash(chapterBody);
  if (String(provenance.chapterTextHash || '').trim().toLowerCase() !== chapterTextHash) {
    return { usable: false, verified: false, reason: 'sample_chapter_text_hash_mismatch' };
  }
  const expectedChapterSha256 = String(provenance.chapterTextSha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(expectedChapterSha256)) {
    return { usable: false, verified: false, reason: 'sample_chapter_text_sha256_missing' };
  }
  if (crypto.createHash('sha256').update(chapterBody).digest('hex') !== expectedChapterSha256) {
    return { usable: false, verified: false, reason: 'sample_chapter_text_sha256_mismatch' };
  }
  const chapterNumber = Number(provenance.chapterNumber);
  if (Number.isInteger(chapterNumber) && Number.isInteger(chapter.number) && chapterNumber !== chapter.number) {
    return { usable: false, verified: false, reason: 'sample_chapter_number_mismatch' };
  }
  const declaredChapter = Array.isArray(fileRecord.record.chapters) ? fileRecord.record.chapters[chapterIndex] : null;
  const expectedChapterId = String(provenance.chapterId || '').trim();
  const declaredChapterId = String(declaredChapter?.chapterId || declaredChapter?.chapterid || declaredChapter?.id || '').trim();
  if (config.requireChapterSetEvidence === true || config.requireChapterOrderEvidence === true) {
    if (!expectedChapterId || !declaredChapterId) return { usable: false, verified: false, reason: 'sample_chapter_id_missing' };
    if (expectedChapterId !== declaredChapterId) return { usable: false, verified: false, reason: 'sample_chapter_id_mismatch' };
  } else if (expectedChapterId && declaredChapterId && expectedChapterId !== declaredChapterId) {
    return { usable: false, verified: false, reason: 'sample_chapter_id_mismatch' };
  }
  const expectedChapterUrl = canonicalizeSourceUrl(provenance.chapterUrl || '');
  const declaredChapterUrl = canonicalizeSourceUrl(declaredChapter?.url || declaredChapter?.chapterUrl || '');
  if (!expectedChapterUrl || !declaredChapterUrl) return { usable: false, verified: false, reason: 'sample_chapter_url_missing' };
  if (expectedChapterUrl !== declaredChapterUrl) return { usable: false, verified: false, reason: 'sample_chapter_url_mismatch' };
  if (provenance.offsetUnit !== 'utf16-code-unit') return { usable: false, verified: false, reason: 'sample_offset_unit_missing' };
  return {
    usable: true,
    verified: true,
    reason: 'verified',
    sourceFilePath,
    sourceContentSha256: rawHash,
    sourceTextSha256: normalizedTextHash,
    chapterTextHash,
    candidateTextHash,
    chapterId: declaredChapterId,
    chapterUrl: declaredChapterUrl,
    offsetUnit: 'utf16-code-unit'
  };
}

/** 对候选行的主 occurrence 和全部附加 occurrence 执行本地溯源校验。
 * 参数：row 为待入库候选；archiveIndex 为 manifest 归档索引；config 为配额配置；archiveEligibility 为作品资格结果。
 * 返回值：所有 occurrence 均通过时返回成功结果，否则返回带 occurrence 序号的失败原因。
 */
function verifyCandidateProvenance(row, archiveIndex, config = {}, archiveEligibility = null) {
  if (config.rawGenreRequiresUsableArchive !== true) return { usable: true, verified: false, reason: 'archive_gate_disabled' };
  const provenance = row?.provenance && typeof row.provenance === 'object' ? row.provenance : {};
  const primary = verifySingleCandidateProvenance(row, provenance, archiveIndex, config, archiveEligibility);
  if (!primary.usable) return primary;
  const occurrences = mergeCandidateOccurrences({ provenance }, row);
  for (let index = 0; index < occurrences.length; index += 1) {
    const result = verifySingleCandidateProvenance(row, occurrences[index], archiveIndex, config, archiveEligibility);
    if (!result.usable) {
      return {
        ...result,
        reason: `sample_occurrence_${index + 1}_${result.reason}`,
        occurrenceIndex: index
      };
    }
  }
  return { ...primary, occurrenceCount: occurrences.length };
}

/**
 * 为中间产物生成不含路径分隔符的稳定文件名。
 * 参数：sourceWorkId 为规范作品 ID。
 * 返回值：中间产物 JSON 文件名。
 */
function intermediateFileName(sourceWorkId) {
  const safe = String(sourceWorkId || 'unresolved').replace(/[^\w.-]+/gu, '_').slice(0, 120) || 'unresolved';
  return `${safe}-${corpusTextHash(sourceWorkId)}.json`;
}

/**
 * 原子写入 JSON，避免建库中断时留下半个中间产物。
 * 参数：filePath 为目标路径；value 为可序列化对象。
 * 返回值：无返回值。
 */
function writeAtomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (process.platform === 'win32') {
    // Windows 对已存在目标的 rename 可能返回 EPERM，使用同目录复制完成可替换写入。
    try {
      fs.copyFileSync(temporaryPath, filePath);
      fs.rmSync(temporaryPath, { force: true });
      return;
    } catch (error) {
      try { fs.rmSync(temporaryPath, { force: true }); } catch (_) {}
      throw error;
    }
  }
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch (_) {}
    throw error;
  }
}

/**
 * 对一个作品的素材行生成变化检测哈希，支持增量跳过未变化作品。
 * 参数：rows 为同一作品的规范素材行数组。
 * 返回值：该作品输入内容的短哈希。
 */
function sourceRowsHash(rows) {
  return corpusTextHash((Array.isArray(rows) ? rows : []).map(row => JSON.stringify({
    sourceWorkId: row.sourceWorkId || '',
    canonicalWorkId: row.canonicalWorkId || '',
    sourceNovelId: row.sourceNovelId || '',
    sourceUrl: row.sourceUrl || '',
    archetype: row.archetype || '',
    dimension: row.dimension || '',
    text: row.text || '',
    rawGenres: row.rawGenres || [],
    primaryGenre: row.primaryGenre || '',
    audience: row.audience || '',
    platform: row.platform || '',
    ranking: row.ranking || {},
    selectionScore: row.selectionScore || {},
    authorization: row.authorization || {},
    completionStatus: row.completionStatus || '',
    provenance: row.provenance || {},
    classification: row.classification || {}
  })).join('\u0002'));
}

/** 生成作品级候选缓存路径，和最终画像中间产物分开保存。
 * 参数：root 为中间产物目录；kind 为 manifest 或 source-list；workIdentity 为作品身份。
 * 返回值：候选缓存 JSON 的绝对路径。
 */
function candidateCachePath(root, kind, workIdentity) {
  return path.join(root, `candidate-${kind}-${intermediateFileName(workIdentity)}`);
}

/** 为作品候选缓存计算包含内容、配置和管线版本的指纹。
 * 参数：kind 为候选来源类型；value 为作品或来源记录；config 为配额配置。
 * 返回值：稳定的候选缓存上下文哈希。
 */
function candidateCacheFingerprint(kind, value, config) {
  return buildContextHash({ kind, value, config, pipelineRevision: PIPELINE_REVISION });
}

/** 读取并校验作品级候选缓存，损坏或指纹不符时返回空值。
 * 参数：root 为中间产物目录；kind 为候选来源类型；workIdentity 为作品身份；fingerprint 为当前指纹。
 * 返回值：可复用的候选记录或 null。
 */
function readCandidateCache(root, kind, workIdentity, fingerprint) {
  if (!root) return null;
  const filePath = candidateCachePath(root, kind, workIdentity);
  const value = readOptionalJson(filePath, null);
  if (value?.schemaVersion !== 'corpus-v3-candidate-intermediate-1'
    || value.workIdentity !== workIdentity
    || value.fingerprint !== fingerprint
    || !Array.isArray(value.rows)) return null;
  return value;
}

/** 原子写入作品级候选缓存，保留待模型复核的原文和章节溯源。
 * 参数：root 为中间产物目录；kind 为候选来源类型；workIdentity 为作品身份；fingerprint 为当前指纹；rows 为候选数组。
 * 返回值：写入的缓存路径；未配置中间目录时返回空字符串。
 */
function writeCandidateCache(root, kind, workIdentity, fingerprint, rows) {
  if (!root) return '';
  const filePath = candidateCachePath(root, kind, workIdentity);
  writeAtomicJson(filePath, {
    schemaVersion: 'corpus-v3-candidate-intermediate-1',
    kind,
    workIdentity,
    fingerprint,
    rowCount: rows.length,
    generatedAt: new Date().toISOString(),
    rows
  });
  return filePath;
}

/** 去除构建上下文中的生成时间字段并按键排序，避免 manifest 重建时间导致无意义重算。
 * 参数：value 为可序列化的构建上下文。
 * 返回值：去除非语义时间字段且键顺序稳定的对象或基础值。
 */
function canonicalizeBuildContext(value) {
  if (Array.isArray(value)) return value.map(canonicalizeBuildContext);
  if (!value || typeof value !== 'object') return value;
  const ignoredKeys = new Set(['generatedAt', 'observedAt', 'updatedAt']);
  return Object.fromEntries(Object.keys(value)
    .filter(key => !ignoredKeys.has(key))
    .sort()
    .map(key => [key, canonicalizeBuildContext(value[key])]));
}

/** 为构建上下文生成稳定哈希，防止配置、来源或 manifest 变化时误复用旧中间产物。
 * 参数：value 为可序列化的构建上下文对象。
 * 返回值：上下文对象的完整 SHA-256 十六进制哈希。
 */
function buildContextHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalizeBuildContext(value ?? null))).digest('hex');
}

/** 按“类型×题材桶×作品”执行单书贡献上限，返回有效样本和截断统计。
 * 参数：samples 为已按文本去重的样本；config 为配额配置；options 可覆盖桶和样本身份解析。
 * 返回值：保留样本、每个交叉格的 raw/effective/trimmed 字数及超限记录。
 */
function selectPerBookCellCap(samples, config, options = {}) {
  const targetChars = Number(config?.cellMinChars || 25000);
  const capPct = Number(config?.perBookCellCapPct || 0.15);
  const capChars = Math.max(1, Math.floor(targetChars * capPct));
  const resolveBucket = options.resolveBucket || (sample => sample.bucket || sample.genreBucket || '');
  const resolveIdentity = options.resolveIdentity || (sample => corpusSampleKey(sample, sample.text));
  const states = new Map();
  const selected = [];
  const selectedIdentities = new Set();
  const ensureState = cellKey => {
    if (!states.has(cellKey)) states.set(cellKey, { cellKey, rawChars: 0, effectiveChars: 0, trimmedChars: 0, rawSampleCount: 0, effectiveSampleCount: 0, byBook: {} });
    return states.get(cellKey);
  };
  for (const sample of Array.isArray(samples) ? samples : []) {
    const bucket = resolveBucket(sample);
    const cellKey = `${sample.archetype || ''}|${bucket}`;
    const sourceWork = sample.sourceWork || logicalWorkId(sample, sample.sourceUrl || `${sample.title || ''}|${sample.author || ''}`);
    const rawChars = countCorpusChars(sample.text);
    const state = ensureState(cellKey);
    const bookState = state.byBook[sourceWork] || { rawChars: 0, effectiveChars: 0, trimmedChars: 0, rawSampleCount: 0, effectiveSampleCount: 0 };
    bookState.rawChars += rawChars;
    bookState.rawSampleCount += 1;
    state.rawChars += rawChars;
    state.rawSampleCount += 1;
    const remaining = Math.max(0, capChars - bookState.effectiveChars);
    if (rawChars > 0 && rawChars <= remaining) {
      selected.push(sample);
      selectedIdentities.add(resolveIdentity(sample));
      bookState.effectiveChars += rawChars;
      bookState.effectiveSampleCount += 1;
      state.effectiveChars += rawChars;
      state.effectiveSampleCount += 1;
    } else {
      bookState.trimmedChars += rawChars;
      state.trimmedChars += rawChars;
    }
    state.byBook[sourceWork] = bookState;
  }
  const perBookCapViolations = [];
  for (const state of states.values()) {
    for (const [sourceWork, bookState] of Object.entries(state.byBook)) {
      if (bookState.effectiveChars > capChars) perBookCapViolations.push({ cellKey: state.cellKey, sourceWork, chars: bookState.effectiveChars, capChars });
    }
  }
  return {
    samples: selected,
    selectedIdentities,
    capChars,
    cells: Object.fromEntries([...states].map(([key, value]) => [key, value])),
    perBookCapViolations
  };
}

/** 对来源清单中的章节文本复用原书质量门禁，避免来源清单绕过同人、问答和完整性检查。
 * 参数：record 为来源记录；chapters 为其中的章节数组；config 为配额配置；blocklist 为 IP 名录。
 * 返回值：包含门禁结果、排除原因和章节统计的质量对象。
 */
function evaluateSourceListQuality(record, chapters, config, blocklist) {
  const values = Array.isArray(chapters) ? chapters : [];
  const text = values.map(chapter => String(chapter?.text || '')).filter(Boolean).join('\n');
  const fanfiction = detectFanfiction(text, blocklist || {});
  const forum = detectForumLike(text, config);
  const chapterRows = values.map((chapter, index) => ({
    title: String(chapter?.title || `第${index + 1}章`),
    chars: String(chapter?.text || '').replace(/\s/gu, '').length
  }));
  const integrity = detectIncomplete(chapterRows, config);
  const declaredChapterCount = Number(record?.chapterCount || record?.chapter_count || record?.totalChapterCount || 0);
  const partial = record?.partial === true
    || record?.quality?.partial === true
    || (declaredChapterCount > 0 && values.length < declaredChapterCount);
  const reasons = [];
  if (fanfiction.isFanfiction || record?.quality?.isFanfiction === true) reasons.push('isFanfiction');
  if (forum.forumLike || record?.quality?.forumLike === true) reasons.push('forumLike');
  if (integrity.incomplete || record?.quality?.incomplete === true) reasons.push('incomplete');
  if (partial) reasons.push('partial');
  if (!values.length || !text.trim()) reasons.push('sourceTextMissing');
  return {
    isFanfiction: fanfiction.isFanfiction || record?.quality?.isFanfiction === true,
    forumLike: forum.forumLike || record?.quality?.forumLike === true,
    incomplete: integrity.incomplete || record?.quality?.incomplete === true,
    partial,
    reasons: [...new Set(reasons)],
    fanfictionHits: fanfiction.hits,
    forumMetrics: forum,
    integrity,
    chapterCount: values.length,
    declaredChapterCount
  };
}

/** 判断一条来源记录是否具备可用于语料抽取的授权、完结、质量和抓取状态。
 * 参数：record 为来源记录；config 为配额配置；quality 为已计算的来源质量结果。
 * 返回值：授权、完结、状态和质量均满足时返回 true，否则返回 false。
 */
function isUsableSourceRecord(record, config, quality = record?.quality) {
  const source = record && typeof record === 'object' ? record : {};
  if (String(source.status || '').toLowerCase() !== 'ok') return false;
  if (quality && Array.isArray(quality.reasons) && quality.reasons.length > 0) return false;
  return evaluateArchiveRecord(source, config || {}).usable;
}

/** 判断 manifest 中一本逻辑作品的所有可用分卷，避免只授权一卷却抽取整本书。
 * 参数：book 为 manifest 逻辑作品；config 为配额配置。
 * 返回值：作品及其分卷均通过质量和授权门禁时返回 true。
 */
function isUsableArchiveBook(book, config) {
  if (!book) return false;
  if (logicalArchiveBookReasons(book).length) return false;
  const parts = Array.isArray(book.parts) && book.parts.length ? book.parts : [book];
  return parts.every(part => evaluateArchiveRecord(materializeArchivePartRecord(book, part), config || {}).usable);
}

/** 将一章正文按原始行范围切成可供分类的候选段落，并保留相对偏移。
 * 参数：text 为章节正文；baseOffset 为正文在原书或来源章节中的起始偏移。
 * 返回值：包含文本、startOffset 和 endOffset 的候选段落数组。
 */
function splitCandidateSegments(text, baseOffset = 0) {
  const source = String(text || '').replace(/\r\n?/gu, '\n');
  const segments = [];
  const linePattern = /[^\n]+/gu;
  for (const match of source.matchAll(linePattern)) {
    const raw = match[0];
    const leading = raw.search(/\S/u);
    const trailing = raw.search(/\s*$/u);
    const start = match.index + Math.max(0, leading);
    const end = trailing < 0 ? match.index + raw.length : match.index + trailing;
    const line = source.slice(start, end).trim();
    if (!line) continue;
    if (line.length <= MAX_CANDIDATE_CHARS) {
      if (line.length >= MIN_CANDIDATE_CHARS) segments.push({ text: line, startOffset: baseOffset + start, endOffset: baseOffset + end });
      continue;
    }
    let cursor = 0;
    for (const pieceMatch of line.matchAll(/[^。！？；]+[。！？；]?/gu)) {
      const piece = pieceMatch[0].trim();
      if (piece.length < MIN_CANDIDATE_CHARS) continue;
      const pieceStart = line.indexOf(piece, cursor);
      const resolvedStart = pieceStart >= 0 ? pieceStart : cursor;
      const resolvedEnd = resolvedStart + piece.length;
      segments.push({
        text: piece.slice(0, MAX_CANDIDATE_CHARS),
        startOffset: baseOffset + start + resolvedStart,
        endOffset: baseOffset + start + Math.min(resolvedEnd, resolvedStart + MAX_CANDIDATE_CHARS)
      });
      cursor = Math.max(cursor, resolvedEnd);
    }
  }
  return segments;
}

/** 用本地词法规则为候选段落生成维度、性格和置信度标签，不改写候选原文。
 * 参数：text 为候选段落原文。
 * 返回值：包含最佳标签、候选标签和可审计规则命中数的分类结果。
 */
function classifyCandidateLexically(text) {
  const source = normalizeSourceText(text);
  const dimensionScores = DIMENSIONS.map(([id]) => ({
    dimension: id,
    score: ARCHIVE_DIMENSION_PATTERNS[id]?.test(source) ? 1 : 0
  })).filter(item => item.score > 0);
  const archetypeScores = Object.entries(ARCHETYPE_LEXICAL_RULES).map(([archetype, patterns]) => ({
    archetype,
    score: patterns.reduce((sum, pattern) => sum + (pattern.test(source) ? 1 : 0), 0)
  })).filter(item => item.score > 0).sort((left, right) => right.score - left.score || left.archetype.localeCompare(right.archetype, 'zh-CN'));
  const best = archetypeScores[0] || null;
  const confidence = best ? Number(Math.min(0.95, 0.45 + best.score * 0.12).toFixed(4)) : 0;
  return {
    method: 'lexical',
    status: best && dimensionScores.length ? 'candidate' : 'unclassified',
    archetype: best?.archetype || '',
    dimension: dimensionScores[0]?.dimension || '',
    archetypeCandidates: archetypeScores.slice(0, 3),
    dimensionCandidates: dimensionScores.map(item => item.dimension),
    confidence,
    modelReview: 'pending',
    characterEvidence: extractCharacterEvidence(source)
  };
}

/** 从候选段落提取人物实体线索和各描写维度的证据跨度，不把线索当作最终人物结论。
 * 参数：text 为候选段落原文。
 * 返回值：待人工或模型确认的人物实体状态、说话线索和维度证据位置。
 */
function extractCharacterEvidence(text) {
  const source = normalizeSourceText(text);
  const candidateNames = candidateNameTerms(source)
    .filter(term => term.length >= 2 && !WHITELIST.has(term))
    .slice(0, 8);
  const speakerCue = /(?:[“「『][^”」』]{2,}[”」』][，。！？；]?(?:说|道|问|答|喊|叫|骂|嘱咐|解释|提醒)|(?:说|道|问|答|喊|叫|骂|嘱咐|解释|提醒)[：:])/u.test(source);
  const evidenceSpans = {};
  for (const [dimension, pattern] of Object.entries(ARCHIVE_DIMENSION_PATTERNS)) {
    const match = source.match(pattern);
    if (!match || match.index == null) continue;
    evidenceSpans[dimension] = {
      start: match.index,
      end: match.index + match[0].length,
      signal: match[0]
    };
  }
  const entityEvidenceSpans = candidateNames.map(name => {
    const start = source.indexOf(name);
    return start >= 0 ? { source: 'text', kind: 'name', start, end: start + name.length, signal: name } : null;
  }).filter(Boolean);
  if (!entityEvidenceSpans.length && speakerCue) {
    const speakerMatch = source.match(/[“「『][^”」』]{2,}[”」』]/u);
    if (speakerMatch?.index != null) {
      entityEvidenceSpans.push({
        source: 'text',
        kind: 'speaker',
        start: speakerMatch.index,
        end: speakerMatch.index + speakerMatch[0].length,
        signal: speakerMatch[0]
      });
    }
  }
  return {
    status: candidateNames.length || speakerCue ? 'candidate' : 'needs_context',
    candidateCount: candidateNames.length,
    candidateNames,
    speakerCue,
    evidenceSpans,
    entityEvidenceSpans,
    method: 'lexical-context'
  };
}

/** 清理人物实体线索供运行时索引使用，保留审计状态但不泄露原书人名。
 * 参数：value 为候选阶段的人物证据对象。
 * 返回值：不含具体人名的可发布人物证据摘要。
 */
function summarizeCharacterEvidence(value) {
  const evidence = value && typeof value === 'object' ? value : {};
  return {
    status: String(evidence.status || 'needs_context'),
    candidateCount: Math.max(0, Number(evidence.candidateCount) || 0),
    speakerCue: evidence.speakerCue === true,
    evidenceSpans: evidence.evidenceSpans && typeof evidence.evidenceSpans === 'object' ? evidence.evidenceSpans : {},
    entityEvidenceSpans: Array.isArray(evidence.entityEvidenceSpans)
      ? evidence.entityEvidenceSpans.map(span => ({ ...span })).slice(0, 8)
      : [],
    method: String(evidence.method || 'unknown')
  };
}

/** 从单章正文抽取带作品、章节、文件哈希和偏移溯源的分类候选。
 * 参数：context 为作品元数据和章节正文；context.chapterText 为当前章节正文。
 * 返回值：候选样本数组，原文保持不变，仅附加分类标签和 provenance。
 */
function extractChapterCandidates(context) {
  const source = context && typeof context === 'object' ? context : {};
  const candidates = [];
  const chapterText = String(source.chapterText || '');
  const chapterHash = corpusTextHash(chapterText);
  const chapterSha256 = crypto.createHash('sha256').update(chapterText).digest('hex');
  for (const segment of splitCandidateSegments(chapterText, Number(source.bodyOffset || 0))) {
    const localStart = Math.max(0, segment.startOffset - Number(source.bodyOffset || 0));
    const localEnd = Math.max(localStart, segment.endOffset - Number(source.bodyOffset || 0));
    const entityContext = {
      before: chapterText.slice(Math.max(0, localStart - 180), localStart),
      after: chapterText.slice(localEnd, Math.min(chapterText.length, localEnd + 180))
    };
    const classification = classifyCandidateLexically(segment.text);
    if (!classification.dimensionCandidates.length) continue;
    for (const dimension of classification.dimensionCandidates) {
      candidates.push({
        title: source.title || '',
        author: source.author || '',
        archetype: classification.archetype,
        dimension,
        text: segment.text,
        sourceWorkId: source.sourceWorkId || '',
        canonicalWorkId: source.canonicalWorkId || source.sourceWorkId || '',
        canonicalWorkIdExplicit: source.canonicalWorkIdExplicit === true,
        sourceNovelId: source.sourceNovelId || '',
        sourceUrl: source.sourceUrl || '',
        platform: source.platform || '',
        genre: (source.rawGenres || []).join('、'),
        rawGenres: [...new Set(source.rawGenres || [])],
        primaryGenre: source.primaryGenre || '',
        audience: source.audience || '',
        ranking: source.ranking || {},
        selectionScore: source.selectionScore || scoreWorkForSelection(source, source.config || {}),
        completionStatus: source.completionStatus || '',
        completionEvidenceRef: source.completionEvidenceRef || '',
        contentScope: source.contentScope || '',
        expectedChapterCount: source.expectedChapterCount || 0,
        fetchedChapterCount: source.fetchedChapterCount || 0,
        chapterCoverage: source.chapterCoverage ?? null,
        authorization: source.authorization || {},
        sourceKind: source.sourceKind || '',
        signals: [...new Set([...classification.archetypeCandidates.map(item => item.archetype), ...classification.dimensionCandidates])],
        classification,
        characterEvidence: classification.characterEvidence,
        entityContext,
        candidateId: `candidate-${corpusTextHash(`${source.sourceWorkId || ''}|${chapterHash}|${segment.text}|${dimension}`)}`,
        provenance: {
          kind: source.provenanceKind || 'archive-chapter',
          sourceFilePath: source.sourceFilePath || '',
          sourceContentHash: source.sourceContentHash || '',
          chapterIndex: Number.isInteger(source.chapterIndex) ? source.chapterIndex : null,
          chapterNumber: Number.isInteger(source.chapterNumber) ? source.chapterNumber : null,
          chapterId: source.chapterId || '',
          chapterTitle: source.chapterTitle || '',
          chapterUrl: source.chapterUrl || source.sourceUrl || '',
          chapterTextHash: chapterHash,
          startOffset: segment.startOffset,
          endOffset: segment.endOffset,
          contextStartOffset: Number(source.bodyOffset || 0) + Math.max(0, localStart - 180),
          contextEndOffset: Number(source.bodyOffset || 0) + Math.min(chapterText.length, localEnd + 180),
          candidateTextHash: corpusTextHash(segment.text),
          candidateTextSha256: crypto.createHash('sha256').update(segment.text).digest('hex'),
          chapterTextSha256: chapterSha256,
          sourceTextHash: source.sourceTextHash || '',
          offsetUnit: 'utf16-code-unit'
        }
      });
    }
  }
  return candidates;
}

/** 从 manifest 中读取已授权原书和分卷，抽取章节级候选而不把原文写入运行时索引。
 * 参数：manifest 为原书 manifest；config 为配额配置。
 * 返回值：授权且质量合格作品的候选样本数组及跳过统计。
 */
function extractManifestCandidates(manifest, config, options = {}) {
  const candidates = [];
  const skipped = { books: 0, files: 0, chapters: 0, cachedWorks: 0, generatedWorks: 0 };
  const books = (Array.isArray(manifest?.books) ? manifest.books : []).slice().sort((left, right) => (
    scoreWorkForSelection(right, config).score - scoreWorkForSelection(left, config).score
      || String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN')
  ));
  for (const book of books) {
    if (!isUsableArchiveBook(book, config)) {
      skipped.books += 1;
      continue;
    }
    const workIdentity = logicalWorkId(book, book.id || normalizeArchiveTitle(book.title));
    const fingerprint = candidateCacheFingerprint('manifest', book, config);
    const cached = !options.force && readCandidateCache(options.intermediate, 'manifest', workIdentity, fingerprint);
    if (cached) {
      candidates.push(...cached.rows);
      skipped.cachedWorks += 1;
      continue;
    }
    const parts = Array.isArray(book.parts) && book.parts.length ? book.parts : [book];
    const bookCandidates = [];
    let missingFile = false;
    for (const part of parts) {
      const relativePath = String(part.filePath || '').replace(/\\/gu, '/');
      const filePath = path.resolve(RESOURCE_ROOT, relativePath);
      if (!relativePath || !fs.existsSync(filePath)) {
        skipped.files += 1;
        missingFile = true;
        continue;
      }
      const buffer = fs.readFileSync(filePath);
      const text = buffer.toString('utf8').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
      const sourceContentHash = crypto.createHash('sha256').update(buffer).digest('hex');
      const sourceTextHash = crypto.createHash('sha256').update(text).digest('hex');
      const chapters = splitChapters(text);
      const declaredChapters = Array.isArray(part.chapters) ? part.chapters : [];
      for (let index = 0; index < chapters.length; index += 1) {
        const chapter = chapters[index];
        const declaredChapter = declaredChapters[index] && typeof declaredChapters[index] === 'object'
          ? declaredChapters[index]
          : {};
        const chapterSlice = text.slice(chapter.start, chapter.end);
        const body = chapter.title === '全文'
          ? chapterSlice
          : chapterSlice.replace(/^[^\r\n]*(?:\r?\n|$)/u, '');
        const bodyOffset = chapter.title === '全文'
          ? chapter.start
          : chapter.start + (chapterSlice.match(/^[^\r\n]*(?:\r?\n|$)/u) || [''])[0].length;
        const chapterCandidates = extractChapterCandidates({
          title: book.title || part.title || '',
          author: book.author || part.author || '',
          sourceWorkId: book.sourceWorkId || part.sourceWorkId || '',
          canonicalWorkId: book.canonicalWorkId || part.canonicalWorkId || book.sourceWorkId || part.sourceWorkId || '',
          canonicalWorkIdExplicit: book.canonicalWorkIdExplicit === true || part.canonicalWorkIdExplicit === true,
          sourceNovelId: book.sourceNovelId || part.sourceNovelId || '',
          sourceUrl: book.sourceUrl || part.sourceUrl || '',
          platform: book.platform || part.platform || '',
          ranking: book.ranking || part.ranking || {},
          selectionScore: scoreWorkForSelection(book, config),
          rawGenres: book.rawGenres?.length ? book.rawGenres : (part.rawGenres || []),
          primaryGenre: book.primaryGenre || part.primaryGenre || '',
          audience: book.audience || part.audience || '',
          completionStatus: book.completionStatus || part.completionStatus || '',
          completionEvidenceRef: book.completionEvidenceRef || part.completionEvidenceRef || '',
          contentScope: book.contentScope || part.contentScope || '',
          expectedChapterCount: book.expectedChapterCount || part.expectedChapterCount || 0,
          fetchedChapterCount: book.fetchedChapterCount || part.fetchedChapterCount || 0,
          chapterCoverage: book.chapterCoverage ?? part.chapterCoverage ?? null,
          authorization: Object.keys(part.authorization || {}).length ? part.authorization : (book.authorization || {}),
          sourceKind: 'archive',
          chapterText: body,
          bodyOffset,
          sourceTextHash,
          chapterIndex: index,
          chapterNumber: chapter.number,
          chapterId: declaredChapter.chapterId || declaredChapter.id || '',
          chapterTitle: chapter.title,
          chapterUrl: declaredChapter.url || declaredChapter.chapterUrl || '',
          sourceFilePath: relativePath,
          sourceContentHash,
          provenanceKind: 'archive-chapter'
        });
        skipped.chapters += chapterCandidates.length ? 0 : 1;
        bookCandidates.push(...chapterCandidates);
      }
    }
    candidates.push(...bookCandidates);
    if (!missingFile) {
      writeCandidateCache(options.intermediate, 'manifest', workIdentity, fingerprint, bookCandidates);
      skipped.generatedWorks += 1;
    }
  }
  return { candidates, skipped };
}

/** 从来源清单中已授权的章节正文抽取候选，兼容尚未落盘为 TXT 的公开章节。
 * 参数：sourceList 为来源清单；config 为配额配置。
 * 返回值：授权且成功来源的候选样本数组及跳过统计。
 */
function extractSourceListCandidates(sourceList, config, blocklist = {}, options = {}) {
  const candidates = [];
  const skipped = { works: 0, chapters: 0, cachedWorks: 0, generatedWorks: 0 };
  const sourceRecords = (Array.isArray(sourceList?.sources) ? sourceList.sources : []).slice().sort((left, right) => (
    scoreWorkForSelection(right, config).score - scoreWorkForSelection(left, config).score
      || String(left.work_title || left.candidate_title || '').localeCompare(String(right.work_title || right.candidate_title || ''), 'zh-CN')
  ));
  for (const rawRecord of sourceRecords) {
    const info = normalizeSourceRecord(rawRecord);
    const chapters = Array.isArray(rawRecord.chapters) ? rawRecord.chapters : [];
    const quality = evaluateSourceListQuality(rawRecord, chapters, config, blocklist);
    if (!isUsableSourceRecord({ ...rawRecord, ...info, quality }, config, quality)) {
      skipped.works += 1;
      continue;
    }
    const workIdentity = info.sourceWorkId || info.canonicalWorkId || `source-${corpusTextHash(info.title)}`;
    const fingerprint = candidateCacheFingerprint('source-list', rawRecord, config);
    const cached = !options.force && readCandidateCache(options.intermediate, 'source-list', workIdentity, fingerprint);
    if (cached) {
      candidates.push(...cached.rows);
      skipped.cachedWorks += 1;
      continue;
    }
    const record = {
      title: info.title,
      author: info.author,
      sourceWorkId: info.sourceWorkId,
      canonicalWorkId: info.canonicalWorkId || info.sourceWorkId,
      canonicalWorkIdExplicit: info.canonicalWorkIdExplicit === true,
      sourceNovelId: info.sourceNovelId,
      sourceUrl: info.sourceUrl,
      platform: info.platform,
      rawGenres: info.genres,
      primaryGenre: info.primaryGenre,
      audience: info.audience,
      repository: info.repository,
      sourcePath: info.sourcePath,
      ranking: normalizeRanking(rawRecord),
      selectionScore: scoreWorkForSelection(info, config),
      authorization: info.authorization,
      completionStatus: info.completionStatus,
      completionEvidenceRef: info.completionEvidenceRef,
      completionObservedAt: info.completionObservedAt,
      contentScope: info.contentScope,
      expectedChapterCount: info.expectedChapterCount,
      fetchedChapterCount: info.fetchedChapterCount,
      chapterCoverage: info.chapterCoverage,
      quality,
      sourceContentHash: String(rawRecord.sourceContentHash || rawRecord.source_content_sha256 || rawRecord.contentHashSha256 || info.contentHash || '').trim().toLowerCase(),
      sourceTextHash: String(rawRecord.sourceTextHash || rawRecord.source_text_hash || '').trim().toLowerCase(),
      sourceFilePath: String(rawRecord.sourceFilePath || rawRecord.localArchivePath || rawRecord.local_archive_path || '').replace(/\\/gu, '/').replace(/^\.\//u, ''),
      sourceKind: info.sourceKind || 'source-list'
    };
    const workCandidates = [];
    for (let index = 0; index < chapters.length; index += 1) {
      const chapter = chapters[index] || {};
      const text = String(chapter.text || '');
      if (!text) {
        skipped.chapters += 1;
        continue;
      }
      const chapterCandidates = extractChapterCandidates({
        ...record,
        chapterText: text,
        sourceFilePath: chapter.sourceFilePath || record.sourceFilePath,
        sourceTextHash: chapter.sourceTextHash || record.sourceTextHash,
        bodyOffset: Number.isInteger(Number(chapter.bodyOffset)) ? Number(chapter.bodyOffset) : 0,
        chapterIndex: index,
        chapterNumber: Number.isInteger(Number(chapter.chapterid ?? chapter.chapterId)) ? Number(chapter.chapterid ?? chapter.chapterId) : null,
        chapterId: chapter.chapterid == null ? '' : String(chapter.chapterid),
        chapterTitle: chapter.title || `第${index + 1}章`,
        chapterUrl: chapter.url || record.sourceUrl,
        sourceContentHash: chapter.sha256 || record.sourceContentHash || corpusTextHash(text),
        provenanceKind: 'source-chapter'
      });
      skipped.chapters += chapterCandidates.length ? 0 : 1;
      workCandidates.push(...chapterCandidates);
    }
    candidates.push(...workCandidates);
    writeCandidateCache(options.intermediate, 'source-list', workIdentity, fingerprint, workCandidates);
    skipped.generatedWorks += 1;
  }
  return { candidates, skipped };
}

/** 汇总原书和来源清单候选并按作品、章节和文本哈希去重。
 * 参数：context 可提供 archiveManifest、sourceList、config 和是否启用候选抽取。
 * 返回值：候选样本、跳过统计和当前分类模式。
 */
function buildArchiveCandidateRows(context = {}) {
  if (context.extractArchiveCandidates === false) return { rows: [], skipped: {}, classificationMode: 'disabled' };
  const manifestResult = extractManifestCandidates(context.archiveManifest, context.config || {}, {
    intermediate: context.intermediate,
    force: context.force === true
  });
  const sourceResult = extractSourceListCandidates(
    context.sourceList,
    context.config || {},
    context.blocklist || readOptionalJson(DEFAULT_BLOCKLIST, { groups: [], minDistinctNames: 2 }),
    { intermediate: context.intermediate, force: context.force === true }
  );
  const unique = new Map();
  for (const row of [...manifestResult.candidates, ...sourceResult.candidates]) {
    const key = corpusSampleKey(row, row.text) + `|${row.dimension || ''}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, { ...row, occurrences: candidateOccurrences(row) });
    } else {
      existing.occurrences = mergeCandidateOccurrences(existing, row);
    }
  }
  return {
    rows: [...unique.values()],
    skipped: { manifest: manifestResult.skipped, sourceList: sourceResult.skipped },
    classificationMode: 'lexical-candidate-model-pending'
  };
}

/** 取得候选文本在原书中的全部出现位置，兼容旧候选的单一 provenance 字段。
 * 参数：row 为候选样本行。
 * 返回值：不含正文的出现位置元数据数组。
 */
function candidateOccurrences(row) {
  const values = Array.isArray(row?.occurrences) && row.occurrences.length
    ? row.occurrences
    : row?.provenance ? [row.provenance] : [];
  return values.filter(item => item && typeof item === 'object').map(item => ({ ...item }));
}

/** 合并文本去重后的候选出现位置，并按位置键去重而不丢失跨章节证据。
 * 参数：rows 为需要合并的候选行数组。
 * 返回值：稳定去重后的 provenance 数组。
 */
function mergeCandidateOccurrences(...rows) {
  const result = [];
  const seen = new Set();
  for (const row of rows) {
    for (const occurrence of candidateOccurrences(row)) {
      const key = [
        occurrence.sourceFilePath || '',
        occurrence.chapterId || '',
        occurrence.chapterIndex ?? '',
        occurrence.chapterNumber ?? '',
        occurrence.chapterUrl || '',
        occurrence.startOffset ?? '',
        occurrence.endOffset ?? '',
        occurrence.candidateTextSha256 || occurrence.candidateTextHash || ''
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(occurrence);
    }
  }
  return result;
}

/** 读取配置中的模型复核置信度下限，缺省采用保守阈值。
 * 参数：config 为配额配置对象。
 * 返回值：0 到 1 之间的置信度下限。
 */
function modelReviewMinimumConfidence(config) {
  const value = Number(config?.modelReview?.minConfidence ?? config?.classificationMinimumConfidence ?? 0.8);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.8;
}

/** 从候选溯源中提取模型复核的完整输入绑定字段。
 * 参数：row 为候选样本行。
 * 返回值：候选、章节、原书和规范化原书文本的哈希对象。
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

/** 比较模型复核结果与当前候选的输入绑定，拒绝缺少或不匹配的旧结果。
 * 参数：row 为当前候选；binding 为复核结果中的 inputBinding。
 * 返回值：绑定字段完整且逐项相等时返回 true。
 */
function matchesCandidateInputBinding(row, binding) {
  const expected = candidateInputBinding(row);
  const actual = binding && typeof binding === 'object' ? binding : {};
  const fields = ['candidateTextHash', 'candidateTextSha256', 'chapterTextHash', 'chapterTextSha256', 'sourceContentHash', 'sourceTextHash'];
  const fullHashFields = new Set(['candidateTextSha256', 'chapterTextSha256', 'sourceContentHash', 'sourceTextHash']);
  return fields.every(field => {
    const expectedValue = expected[field];
    const actualValue = String(actual[field] || '').trim().toLowerCase();
    const pattern = fullHashFields.has(field) ? /^[a-f0-9]{64}$/iu : /^[a-f0-9]{16}$/iu;
    return pattern.test(expectedValue) && actualValue === expectedValue;
  });
}

/** 校验模型返回的证据跨度均位于候选文本内，并覆盖复核后的目标维度。
 * 参数：value 为模型 evidenceSpans；text 为候选正文；dimension 为复核维度。
 * 返回值：跨度结构、边界和目标维度均合格时返回 true。
 */
function validModelEvidenceSpans(value, text, dimension) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const candidateText = String(text || '');
  let spanCount = 0;
  let targetCovered = false;
  for (const [axis, rawSpans] of Object.entries(source)) {
    if (!DIMENSIONS.some(([id]) => id === axis)) return false;
    const spans = Array.isArray(rawSpans) ? rawSpans : [rawSpans];
    if (!spans.length) return false;
    for (const span of spans) {
      const start = Number(span?.start);
      const end = Number(span?.end);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > candidateText.length) return false;
      if (typeof span?.signal === 'string' && candidateText.slice(start, end) !== span.signal) return false;
      spanCount += 1;
      if (axis === dimension) targetCovered = true;
    }
  }
  return spanCount > 0 && targetCovered;
}

/** 校验模型返回的人物实体证据是否能在候选文本或前后文中回读到人物名。
 * 参数：value 为模型 entityEvidenceSpans；characterName 为模型确认的人物名；text 为候选文本；entityContext 为候选前后文。
 * 返回值：人物名合法且至少一条实体跨度准确覆盖人物名时返回 true。
 */
function validModelEntityEvidenceSpans(value, characterName, text, entityContext = {}) {
  const name = String(characterName || '').trim();
  const candidateText = String(text || '');
  const context = entityContext && typeof entityContext === 'object' ? entityContext : {};
  const sources = {
    text: candidateText,
    before: String(context.before || ''),
    after: String(context.after || '')
  };
  if (name.length < 2 || name.length > 40 || /\s/gu.test(name) || WHITELIST.has(name) || COMMON_TERMS.has(name)) return false;
  if (NON_GIVEN_NAME_TAIL.test(name[name.length - 1])) return false;
  const spans = Array.isArray(value) ? value : [];
  let nameCovered = false;
  for (const span of spans) {
    const source = String(span?.source || '').trim();
    const sourceText = sources[source];
    const start = Number(span?.start);
    const end = Number(span?.end);
    if (!sourceText || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > sourceText.length) return false;
    const signal = sourceText.slice(start, end);
    if (typeof span?.signal === 'string' && signal !== span.signal) return false;
    if (signal.includes(name)) nameCovered = true;
  }
  return spans.length > 0 && nameCovered;
}

/** 为同一逻辑作品内的人物名生成稳定标识，忽略模型自行提交的 characterKey。
 * 参数：row 为候选样本；characterName 为已通过实体证据校验的人物名。
 * 返回值：作品 ID 与人物名组合后的稳定短哈希；任一字段缺失时返回空字符串。
 */
function stableCharacterKey(row, characterName) {
  const name = String(characterName || '').trim();
  const workId = logicalWorkId(row, row?.sourceUrl || `${row?.title || ''}|${row?.author || ''}`);
  return name && workId ? corpusTextHash(`${workId}|${name}`) : '';
}

/** 判断一条原书候选是否已经通过模型复核门禁，待复核和低置信度候选只能留在隔离区。
 * 参数：row 为候选样本；config 为配额配置。
 * 返回值：候选通过复核且置信度达标时返回 true。
 */
function isApprovedArchiveCandidate(row, config) {
  const candidate = row && typeof row === 'object' ? row : {};
  const evidenceConfig = config?.characterEvidence && typeof config.characterEvidence === 'object' ? config.characterEvidence : {};
  const modelConfig = config?.modelReview && typeof config.modelReview === 'object' ? config.modelReview : {};
  if (modelConfig.required === true && (!String(candidate.candidateId || '').trim()
    || !candidate.classification || typeof candidate.classification !== 'object' || Array.isArray(candidate.classification))) return false;
  if (!candidate.candidateId && !candidate.classification) return true;
  const classification = candidate.classification || {};
  const entityStatus = String(classification.entityStatus || candidate.characterEvidence?.status || '').trim();
  const entityGateEnabled = evidenceConfig.required === true && evidenceConfig.requireConfirmedEntity === true;
  const characterName = String(classification.characterName || '').trim();
  const entityPass = !entityGateEnabled
    || (entityStatus === 'confirmed'
      && validModelEntityEvidenceSpans(classification.entityEvidenceSpans, characterName, candidate.text, candidate.entityContext));
  const catchphrasePass = candidate.dimension !== 'catchphrase'
    || evidenceConfig.required !== true
    || classification.catchphraseStatus === 'confirmed';
  const expectedCharacterKey = stableCharacterKey(candidate, characterName);
  const characterKey = String(classification.characterKey || '').trim();
  const characterKeyPass = evidenceConfig.required !== true
    ? true
    : entityGateEnabled
      ? Boolean(expectedCharacterKey) && characterKey === expectedCharacterKey
      : Boolean(characterKey);
  const configuredModelId = String(modelConfig.modelId || '').trim();
  const reviewModelId = String(classification.modelId || '').trim();
  const reviewVersionPass = modelConfig.required !== true
    || (reviewModelId
      && (!configuredModelId || reviewModelId === configuredModelId)
      && String(classification.promptVersion || '').trim() === MODEL_REVIEW_PROMPT_VERSION);
  const inputBindingPass = modelConfig.requireInputBinding !== true
    || matchesCandidateInputBinding(candidate, classification.inputBinding);
  const evidenceSpansPass = modelConfig.requireEvidenceSpans !== true
    || validModelEvidenceSpans(classification.evidenceSpans, candidate.text, candidate.dimension);
  return classification.modelReview === 'approved'
    && Number.isFinite(Number(classification.modelConfidence))
    && Number(classification.modelConfidence) >= modelReviewMinimumConfidence(config)
    && entityPass
    && catchphrasePass
    && characterKeyPass
    && reviewVersionPass
    && inputBindingPass
    && evidenceSpansPass;
}

/** 应用外部模型复核结果，只接受合法类型、维度、人物实体状态和足够置信度，不改写候选原文。
 * 参数：rows 为词法候选；reviewFile 为复核结果 JSON 路径；config 为配额配置，可为空。
 * 返回值：带复核状态的候选行、匹配数量、拒绝数量和文件状态。
 */
function applyClassificationReviews(rows, reviewFile = '', config = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (!reviewFile) return { rows: sourceRows, file: '', matched: 0, approved: 0, rejected: 0, invalid: 0, pending: sourceRows.length };
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
  } catch (error) {
    return { rows: sourceRows, file: reviewFile, matched: 0, approved: 0, rejected: 0, invalid: 0, pending: sourceRows.length, error: `无法读取复核文件：${error.message}` };
  }
  const declaredModelId = String(payload?.modelId || '').trim();
  const reviews = (Array.isArray(payload?.reviews) ? payload.reviews : []).filter(review => (
    !declaredModelId || String(review?.modelId || '').trim() === declaredModelId
  ));
  const reviewById = new Map(reviews.map(review => [String(review?.candidateId || ''), review]).filter(([id]) => id));
  let matched = 0;
  let approved = 0;
  let rejected = 0;
  let invalid = 0;
  const minimumConfidence = modelReviewMinimumConfidence(config);
  const nextRows = sourceRows.map(row => {
    const review = reviewById.get(String(row.candidateId || ''));
    if (!review) return row;
    matched += 1;
    const isMatch = review.isMatch === true;
    const archetype = String(review.archetype || '').trim();
    const dimension = String(review.dimension || '').trim();
    const reviewedArchetype = archetype || row.archetype;
    const reviewedDimension = dimension || row.dimension;
    const confidence = Number(review.confidence);
    const entityStatus = ['confirmed', 'candidate', 'needs_context', 'unresolved', 'rejected'].includes(String(review.characterEntityStatus || '').trim())
      ? String(review.characterEntityStatus).trim()
      : row.characterEvidence?.status || 'needs_context';
    const evidenceConfig = config?.characterEvidence && typeof config.characterEvidence === 'object' ? config.characterEvidence : {};
    const entityGateEnabled = evidenceConfig.required === true && evidenceConfig.requireConfirmedEntity === true;
    const reviewedCharacterName = String(review.characterName || '').trim();
    const entityEvidenceSpans = Array.isArray(review.entityEvidenceSpans) ? review.entityEvidenceSpans : [];
    const entityEvidencePass = !entityGateEnabled
      || validModelEntityEvidenceSpans(entityEvidenceSpans, reviewedCharacterName, row.text, row.entityContext);
    const entityPass = !entityGateEnabled || (entityStatus === 'confirmed' && entityEvidencePass);
    const characterKey = entityGateEnabled && entityPass
      ? stableCharacterKey(row, reviewedCharacterName)
      : entityGateEnabled ? '' : String(row.classification?.characterKey || '').trim();
    const expectedCharacterKey = stableCharacterKey(row, reviewedCharacterName);
    const characterKeyPass = evidenceConfig.required !== true
      ? true
      : entityGateEnabled
        ? Boolean(expectedCharacterKey) && characterKey === expectedCharacterKey
        : Boolean(characterKey);
    const modelReviewConfig = config?.modelReview && typeof config.modelReview === 'object' ? config.modelReview : {};
    const configuredModelId = String(modelReviewConfig.modelId || '').trim();
    const reviewModelId = String(review.modelId || '').trim();
    const reviewVersionPass = modelReviewConfig.required !== true
      || (reviewModelId
        && (!configuredModelId || reviewModelId === configuredModelId)
        && String(review.promptVersion || '').trim() === MODEL_REVIEW_PROMPT_VERSION);
    const inputBindingPass = modelReviewConfig.requireInputBinding !== true
      || matchesCandidateInputBinding(row, review.inputBinding);
    const evidenceSpans = review.evidenceSpans && typeof review.evidenceSpans === 'object' ? review.evidenceSpans : {};
    const evidenceSpansPass = modelReviewConfig.requireEvidenceSpans !== true
      || validModelEvidenceSpans(evidenceSpans, row.text, reviewedDimension);
    const valid = isMatch
      && ARCHETYPES.includes(reviewedArchetype)
      && DIMENSIONS.some(([id]) => id === reviewedDimension)
      && Number.isFinite(confidence)
      && confidence >= minimumConfidence
      && entityPass
      && characterKeyPass
      && reviewVersionPass
      && inputBindingPass
      && evidenceSpansPass;
    const classification = {
      ...(row.classification || {}),
      method: valid ? 'lexical+model' : 'lexical+model-rejected',
      modelReview: valid ? 'approved' : 'rejected',
      modelConfidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
      modelReviewMinimumConfidence: minimumConfidence,
      modelReviewReason: valid ? '' : !isMatch ? 'model_rejected' : !reviewVersionPass ? 'review_version_missing_or_mismatch' : !inputBindingPass ? 'review_input_binding_mismatch' : !evidenceSpansPass ? 'evidence_spans_invalid' : !entityPass ? (entityStatus !== 'confirmed' ? 'character_entity_unconfirmed' : 'character_entity_evidence_invalid') : !characterKeyPass ? 'character_key_missing_or_mismatch' : !Number.isFinite(confidence) || confidence < minimumConfidence ? 'confidence_below_threshold' : 'label_context_mismatch',
      entityStatus,
      characterName: reviewedCharacterName,
      characterKey,
      evidenceSpans,
      entityEvidenceSpans,
      inputBinding: review.inputBinding && typeof review.inputBinding === 'object' ? { ...review.inputBinding } : {},
      modelId: String(review.modelId || '').trim(),
      promptVersion: String(review.promptVersion || '').trim(),
      reviewedAt: String(review.reviewedAt || '').trim()
    };
    if (!valid) {
      if (isMatch) invalid += 1;
      else rejected += 1;
      return { ...row, archetype: '', dimension: '', classification };
    }
    approved += 1;
    return {
      ...row,
      archetype: reviewedArchetype,
      dimension: reviewedDimension,
      characterEvidence: { ...(row.characterEvidence || {}), status: entityStatus, evidenceSpans, entityEvidenceSpans },
      classification
    };
  });
  return { rows: nextRows, file: reviewFile, matched, approved, rejected, invalid, pending: sourceRows.length - matched };
}

/** 从带引号的对白中提取可跨上下文比较的稳定短语，过滤单字语气词和纯标点。
 * 参数：text 为候选段落原文。
 * 返回值：去重后的短语数组，不返回段落外的原文上下文。
 */
function extractCatchphraseForms(text) {
  const source = normalizeSourceText(text);
  const quoted = [...source.matchAll(/[“「『]([^”」』]{2,80})[”」』]/gu)].map(match => match[1]);
  const values = quoted.length ? quoted : [source];
  const stopForms = new Set(['嗯', '啊', '哎', '唉', '哦', '喂', '呀', '啦', '哈', '呵']);
  const forms = new Set();
  for (const value of values) {
    const clauses = String(value)
      .split(/[，,。！？；：:、\s]+/u)
      .map(item => item.replace(/^[“「『”」』]+|[“「『”」』]+$/gu, '').trim())
      .filter(item => item.length >= 2 && item.length <= 24 && !stopForms.has(item));
    for (const clause of clauses) forms.add(clause);
    const compact = String(value).replace(/[，,。！？；：:、\s]+/gu, '').trim();
    if (compact.length >= 2 && compact.length <= 24 && !stopForms.has(compact)) forms.add(compact);
  }
  return [...forms];
}

/** 按作品、人物标识和跨章节重复次数确认口头禅，单段语气词只保留为候选。
 * 参数：rows 为已完成模型复核或仍待复核的候选；config 为配额配置。
 * 返回值：附加 catchphraseStatus 和短语证据计数的候选数组，不改写任何原文。
 */
function confirmCatchphraseRows(rows, config = {}) {
  const values = Array.isArray(rows) ? rows : [];
  const minimumChapters = Math.max(1, Number(config?.characterEvidence?.catchphraseMinimumChapters || 3));
  const groups = new Map();
  for (const row of values) {
    if (row.dimension !== 'catchphrase') continue;
    const characterKey = String(row.classification?.characterKey || '').trim();
    const workKey = logicalWorkId(row, row.sourceUrl || `${row.title}|${row.author}`);
    if (!characterKey || !workKey) continue;
    const occurrences = candidateOccurrences(row);
    const chapters = occurrences
      .map(occurrence => occurrence.chapterNumber ?? occurrence.chapterIndex)
      .filter(chapter => chapter !== null && chapter !== undefined)
      .map(String);
    if (!chapters.length) continue;
    for (const phrase of extractCatchphraseForms(row.text)) {
      const key = `${workKey}|${characterKey}|${corpusTextHash(phrase)}`;
      if (!groups.has(key)) groups.set(key, { phrase, chapters: new Set(), rows: [] });
      const group = groups.get(key);
      for (const chapter of chapters) group.chapters.add(chapter);
      if (!group.rows.includes(row)) group.rows.push(row);
    }
  }
  const rowEvidence = new Map();
  for (const group of groups.values()) {
    if (group.chapters.size < minimumChapters) continue;
    for (const row of group.rows) {
      const id = String(row.candidateId || '');
      if (!id) continue;
      const current = rowEvidence.get(id) || { phrases: new Set(), chapters: new Set() };
      current.phrases.add(corpusTextHash(group.phrase));
      for (const chapter of group.chapters) current.chapters.add(chapter);
      rowEvidence.set(id, current);
    }
  }
  return values.map(row => {
    if (row.dimension !== 'catchphrase') return row;
    const evidence = rowEvidence.get(String(row.candidateId || ''));
    const status = evidence ? 'confirmed' : 'candidate';
    return {
      ...row,
      classification: {
        ...(row.classification || {}),
        catchphraseStatus: status,
        catchphrasePhraseCount: evidence?.phrases.size || 0,
        catchphraseChapterCount: evidence?.chapters.size || 0
      },
      characterEvidence: {
        ...(row.characterEvidence || {}),
        catchphraseStatus: status,
        catchphrasePhraseCount: evidence?.phrases.size || 0,
        catchphraseChapterCount: evidence?.chapters.size || 0
      }
    };
  });
}

/**
 * 按作品生成或复用中间产物，并在每本书完成后更新进度文件。
 * 参数：rows 为规范素材行；options 为建库选项；inputHash 为总输入哈希。
 * 返回值：供最终建库使用的行、处理/跳过数量和进度路径。
 */
function buildIncrementalCorpus(rows, options = {}, inputHash = '', context = {}) {
  const root = options.intermediate;
  if (!root) return { rows, processedBooks: 0, skippedBooks: 0, progressPath: '' };
  fs.mkdirSync(root, { recursive: true });
  const progressPath = path.join(root, 'progress.json');
  const previous = readOptionalJson(progressPath, {});
  const contextValue = {
    inputSha256: inputHash,
    sourceList: context.sourceList ?? options.sourceList ?? null,
    archiveManifest: context.archiveManifest ?? options.archiveManifest ?? null,
    quotaConfig: context.config ?? options.config ?? null,
    pipelineRevision: PIPELINE_REVISION
  };
  const contextHash = buildContextHash(contextValue);
  const reusableBooks = previous?.contextSha256 === contextHash && previous && typeof previous.books === 'object'
    ? previous.books
    : {};
  const progress = {
    schemaVersion: 'corpus-v3-progress-1',
    inputSha256: inputHash,
    sourceListSha256: buildContextHash(contextValue.sourceList),
    manifestSha256: buildContextHash(contextValue.archiveManifest),
    configSha256: buildContextHash(contextValue.quotaConfig),
    pipelineRevision: PIPELINE_REVISION,
    contextSha256: contextHash,
    updatedAt: new Date().toISOString(),
    books: reusableBooks
  };
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const workIdentity = logicalWorkId(row, `unresolved-${corpusTextHash(`${row.title}|${row.author}|${row.sourceUrl}`)}`);
    if (!grouped.has(workIdentity)) grouped.set(workIdentity, []);
    grouped.get(workIdentity).push({ ...row, canonicalWorkId: row.canonicalWorkId || workIdentity });
  }
  const outputRows = [];
  let processedBooks = 0;
  let skippedBooks = 0;
  for (const [workIdentity, sourceRows] of grouped) {
    const rowHash = sourceRowsHash(sourceRows);
    const intermediatePath = path.join(root, intermediateFileName(workIdentity));
    const previousBook = progress.books[workIdentity];
    let record = null;
    if (!options.force
      && previous?.contextSha256 === contextHash
      && previousBook?.status === 'completed'
      && previousBook.rowHash === rowHash
      && previousBook.contextSha256 === contextHash
      && fs.existsSync(intermediatePath)) {
      const cached = readOptionalJson(intermediatePath, null);
      if (cached?.schemaVersion === 'corpus-v3-intermediate-1'
        && cached.rowHash === rowHash
        && cached.contextSha256 === contextHash
        && Array.isArray(cached.rows)) {
        record = cached;
        skippedBooks += 1;
      }
    }
    if (!record) {
      const first = sourceRows[0] || {};
      record = {
        schemaVersion: 'corpus-v3-intermediate-1',
        sourceWorkId: first.sourceWorkId || '',
        canonicalWorkId: first.canonicalWorkId || workIdentity,
        sourceNovelId: first.sourceNovelId || '',
        title: first.title || '',
        author: first.author || '',
        sourceUrl: first.sourceUrl || '',
        platform: first.platform || '',
        rawGenres: first.rawGenres || [],
        rowHash,
        contextSha256: contextHash,
        rowCount: sourceRows.length,
        generatedAt: new Date().toISOString(),
        rows: sourceRows
      };
      writeAtomicJson(intermediatePath, record);
      processedBooks += 1;
    }
    outputRows.push(...record.rows);
    progress.books[workIdentity] = {
      status: 'completed',
      sourceWorkId: record.sourceWorkId || '',
      canonicalWorkId: record.canonicalWorkId || workIdentity,
      rowHash,
      contextSha256: contextHash,
      rowCount: record.rows.length,
      intermediatePath: path.relative(RESOURCE_ROOT, intermediatePath).replace(/\\/g, '/'),
      updatedAt: record.generatedAt || new Date().toISOString()
    };
    progress.updatedAt = new Date().toISOString();
    progress.completedBookIds = Object.keys(progress.books).filter(id => progress.books[id]?.status === 'completed').sort();
    writeAtomicJson(progressPath, progress);
  }
  return { rows: outputRows, processedBooks, skippedBooks, progressPath };
}

/** Normalize raw sample text and discard formatting noise from the source Markdown. */
function normalizeSourceText(value) {
  return normalizeCorpusText(value);
}

/** Extract the source title and author from one Markdown sample heading. */
function parseSampleHeading(value) {
  const source = String(value || '').replace(/^\*\*|\*\*$/g, '').trim();
  const body = source.replace(/^\d+\.\s*/, '');
  const separator = body.lastIndexOf(' · ');
  const title = separator >= 0 ? body.slice(0, separator).trim() : body;
  const author = separator >= 0 ? body.slice(separator + 3).trim() : '';
  return { title: title.replace(/^《|》$/g, ''), author };
}

/** Parse one source metadata quote into genre, location, signals and URL fields. */
function parseSampleMetadata(value) {
  const source = String(value || '').replace(/^>\s?/, '').trim();
  const genre = (source.match(/^题材：([^；]+)；/) || [])[1] || '';
  const sourceUrl = (source.match(/\[原文定位\]\(([^)]+)\)/) || [])[1] || '';
  const signalsValue = (source.match(/规则信号：(.+)$/) || [])[1] || '';
  const signals = signalsValue === '无' ? [] : signalsValue.split(/[、,，\s]+/).map(item => item.trim()).filter(Boolean).slice(0, 12);
  return { genre: genre.trim(), sourceUrl, signals };
}

/** 判断一行是否为发布版的溯源元数据，避免重跑时把元数据并入正文。
 * 参数：line 为 Markdown 单行文本。
 * 返回值：该行属于发布版溯源信息时返回 true。
 */
function isPublishedProvenanceLine(line) {
  return /^>\s*(?:来源哈希|样本ID|作品ID|归档文件|章节ID|章节标题|原文偏移|其他回读位置)：/u.test(String(line || ''));
}

/** Parse the six dimensions and ten archetype sections from the supplied Markdown corpus. */
function parseSourceMarkdown(markdown) {
  const rows = [];
  const lines = String(markdown || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  let archetype = '';
  let dimension = '';
  let pending = null;
  const flush = () => {
    if (!pending || !pending.text) return;
    rows.push({ ...pending, text: normalizeSourceText(pending.text) });
    pending = null;
  };
  for (const line of lines) {
    const archetypeMatch = line.match(/^##\s+(.+?)\s*$/);
    if (archetypeMatch && ARCHETYPES.includes(archetypeMatch[1].trim())) {
      flush();
      archetype = archetypeMatch[1].trim();
      dimension = '';
      continue;
    }
    const dimensionMatch = line.match(/^###\s+(.+?)\s*$/);
    if (dimensionMatch && DIMENSIONS.some(item => item[1] === dimensionMatch[1].trim())) {
      flush();
      dimension = DIMENSIONS.find(item => item[1] === dimensionMatch[1].trim())[0];
      continue;
    }
    const headingMatch = line.match(/^\*\*\d+\.\s+.+\*\*$/);
    if (headingMatch && archetype && dimension) {
      flush();
      pending = { ...parseSampleHeading(line), archetype, dimension, text: '', metadata: null };
      continue;
    }
    if (!pending) continue;
    if (isPublishedProvenanceLine(line)) {
      pending.metadata ||= { genre: '', sourceUrl: '', signals: [] };
      continue;
    }
    if (line.startsWith('>') && !pending.metadata) {
      pending.metadata = parseSampleMetadata(line);
      Object.assign(pending, pending.metadata);
      continue;
    }
    if (line.startsWith('>') && pending.metadata) {
      pending.text += ' ' + line.replace(/^>\s?/, '');
    }
  }
  flush();
  return rows.filter(row => row.archetype && row.dimension && row.text);
}

/** Decide whether a raw sample is too short, too noisy, or too weak to teach a writing mechanism. */
function isLowInformationSample(row) {
  const text = normalizeSourceText(row && row.text);
  if (text.length < 24 || text.length > 1000) return true;
  if (/^(嗯|哦|啊|好|是|不|行|喂)[！!。？?，,\s]*$/u.test(text)) return true;
  const signalCount = Array.isArray(row && row.signals) ? row.signals.length : 0;
  const punctuationCount = (text.match(/[，。！？；：“”‘’]/g) || []).length;
  return signalCount === 0 && punctuationCount === 0 && text.length < 40;
}

/** Trim a sample at a natural punctuation boundary while keeping strong-mode context bounded. */
function boundSampleText(value, maxLength = 120) {
  const text = normalizeSourceText(value);
  if (text.length <= maxLength) return text;
  const candidate = text.slice(0, maxLength);
  const boundary = Math.max(candidate.lastIndexOf('。'), candidate.lastIndexOf('！'), candidate.lastIndexOf('？'), candidate.lastIndexOf('；'));
  return (boundary >= 60 ? candidate.slice(0, boundary + 1) : candidate).trim();
}

/** Find likely two- or three-character Chinese names with a surname and sentence context. */
function candidateNameTerms(value) {
  const source = normalizeSourceText(value);
  const candidates = [];
  const namePattern = new RegExp(`(${STRICT_SURNAME_PATTERN.source}[\\u4e00-\\u9fff]{1,2})`, 'gu');
  const allowedAfter = /^(?:说|道|问|答|喊|叫|笑|哭|骂|劝|看|望|盯|瞥|抬|低|垂|握|抓|捏|咬|走|跑|退|进|转|停|开|起|坐|躲|挡|拦|应|察|想|见|伸|打|抱|拿|接|推|带|沉|眯|：|，|。|！|？|”|」|』)/u;
  const allowedBefore = /[着了把将让对向给从与和问喊骂劝看望盯瞥抬低垂握抓捏咬走跑退进转停开起坐躲挡拦抱拿接推带沉眯斥]/u;
  const speakerVerbTail = /[说道问答喊叫笑哭骂劝]/u;
  let match;
  while ((match = namePattern.exec(source))) {
    const token = match[1];
    const tokenStart = match.index + match[0].length - token.length;
    const beforeToken = source.slice(tokenStart - 1, tokenStart);
    const sentenceBoundary = !beforeToken || /[。！？；：、“”‘’「」『』，,\s…—]/u.test(beforeToken);
    const contextualPrefix = sentenceBoundary || allowedBefore.test(beforeToken);
    if (!contextualPrefix || COMMON_NAME_PREFIXES.some(prefix => source.startsWith(prefix, tokenStart))) continue;
    for (const length of [3, 2]) {
      const valuePart = token.slice(0, length);
      const afterText = source.slice(tokenStart + length, tokenStart + length + 4);
      const after = afterText.slice(0, 1);
      const givenPart = valuePart.slice(1);
      const startsWithNameParticle = /^[不没无未非]/u.test(givenPart) && !/^[大小老少]/u.test(givenPart);
      const endsAtStrongBoundary = /^[，。！？：”」』\s]/u.test(after);
      const forbiddenTail = NON_GIVEN_NAME_TAIL.test(givenPart)
        && !(length === 3 && endsAtStrongBoundary && !speakerVerbTail.test(givenPart.slice(-1)));
      if (valuePart.length < 2 || COMMON_TERMS.has(valuePart) || NAME_STOP_CHARS.test(givenPart) || forbiddenTail || startsWithNameParticle) continue;
      if (NAME_DISCOURSE_CONTEXT_PATTERN.test(afterText) || !allowedAfter.test(afterText)) continue;
      if (valuePart.length === 2 && (NAME_MODIFIER_PATTERN.test(valuePart.slice(1)) || valuePart[0] === valuePart[1])) continue;
      candidates.push(valuePart);
      break;
    }
  }
  return [...new Set(candidates)].filter(term => !COMMON_TERMS.has(term) && term.length >= 2 && term.length <= 3);
}

// The CLI loads the optional native dictionary asynchronously before the pure build.

// 引号/对话标记集合：人名常出现在引语前后，用于高频组合的邻接验证
const QUOTE_MARKERS = new Set(['"', '“', '”', '‘', '’', '「', '」', '『', '』', '：', '—']);

// 全库扫描：只把在强上下文中重复出现的姓名候选纳入词典，避免把普通四字词当成人名。
function scanCorpusNameCombos(markdown) {
  const text = String(markdown || '');
  const combos = new Map();
  const corpusTexts = /(?:^|\n)##\s+/u.test(text)
    ? parseSourceMarkdown(text).map(row => row.text)
    : [text];
  for (const sample of corpusTexts) {
    for (const combo of candidateNameTerms(sample)) {
      const current = combos.get(combo) || { occurrences: 0, samples: 0 };
      current.occurrences += sample.split(combo).length - 1;
      current.samples += 1;
      combos.set(combo, current);
    }
  }
  const result = new Set();
  for (const [combo, count] of combos) {
    if (count.occurrences >= 3 && (corpusTexts.length === 1 || count.samples >= 2) && !WHITELIST.has(combo) && !COMMON_TERMS.has(combo)) result.add(combo);
  }
  return result;
}

// 切句边界修复：样本开头若是残留右引号，则包含到配对左引号（含被引内容）或从引号后开始截取
function fixQuoteBoundary(value) {
  const text = normalizeSourceText(value);
  if (!text) return text;
  // 样本按句切分后可能从对白中间开始，删除孤立的右引号即可；不能截断后续正文。
  return text.replace(/^[”」』’]+/u, '').trim();
}

// 体裁/问答特征判定：含论坛/问答体标记的样本不适合做写作素材，予以剔除
function isQaSample(row) {
  const text = normalizeSourceText(row && row.text);
  return /请问|怎么办|求助|内容：/.test(text);
}

// 破坏自检：匿名化后 [人物] 占比过高或出现破碎组合模式的样本整条剔除
function isBrokenAnonymization(text) {
  const placeholder = '[人物]';
  const count = text.split(placeholder).length - 1;
  const ratio = text.length > 0 ? (count * placeholder.length) / text.length : 0;
  if (count >= 5 && ratio > 0.2) return true;
  if (count >= 3 && ratio > 0.35) return true;
  if (text.includes('又[人物]又')) return true;
  if (/\[人物\]地/.test(text)) return true;
  return false;
}

/** 将同一人名的首次出现替换为占位符，后续出现改为中性指代，降低短样本的占位符密度。
 * 参数：text 为待匿名化文本；term 为需要替换的专名；placeholder 为首次出现的替代词。
 * 返回值：替换后的文本。
 */
function replaceNameOccurrences(text, term, placeholder) {
  const escaped = String(term || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  let occurrence = 0;
  return String(text || '').replace(new RegExp(escaped, 'gu'), () => {
    occurrence += 1;
    return occurrence === 1 ? placeholder : '对方';
  });
}

/** Anonymize source-specific names and return terms used for server-side leakage auditing. */
function anonymizeSample(row, nameDictionary = new Set()) {
  let text = fixQuoteBoundary(row.text);
  text = normalizeSourceText(text);
  const forbiddenTerms = new Set();
  const directTerms = [row.title, row.author].map(value => String(value || '').replace(/[《》【】（）()]/g, '').trim()).filter(value => value.length >= 2);
  directTerms.forEach(term => {
    if (WHITELIST.has(term)) return;
    if (text.includes(term)) {
      forbiddenTerms.add(term);
      text = replaceNameOccurrences(text, term, '[专名]');
    }
  });
  // 字典精确匹配（数据库真实人名 + 语料高频引号邻接组合），优先于正则、精度更高
  const dictTerms = [...nameDictionary].filter(term => term && term.length >= 2 && !WHITELIST.has(term) && !NON_GIVEN_NAME_TAIL.test(term[term.length - 1])).sort((left, right) => right.length - left.length);
  dictTerms.forEach(term => {
    if (text.includes(term)) {
      forbiddenTerms.add(term);
      text = replaceNameOccurrences(text, term, '[人物]');
    }
  });
  // 正则姓氏兜底：捕获字典未覆盖的人名（白名单词与末字非给定名的词不参与替换与审计）
  candidateNameTerms(text).sort((left, right) => right.length - left.length).forEach(term => {
    if (WHITELIST.has(term) || NON_GIVEN_NAME_TAIL.test(term[term.length - 1])) return;
    forbiddenTerms.add(term);
    text = replaceNameOccurrences(text, term, '[人物]');
  });
  text = boundSampleText(text);
  const residualTerms = candidateNameTerms(text).filter(term => !WHITELIST.has(term));
  residualTerms.forEach(term => forbiddenTerms.add(term));
  return { text, forbiddenTerms: [...forbiddenTerms].slice(0, 20), residualTerms };
}

/** Score the teaching value of an anonymized sample for deterministic ranking. */
function scoreSample(row, text) {
  const lengthScore = Math.min(1, text.length / 100);
  const signalScore = Math.min(1, (Array.isArray(row.signals) ? row.signals.length : 0) / 3);
  const actionScore = /看|望|转|停|握|抬|垂|笑|咬|说|问|答|走|退|靠|抓|捏|呼吸|心里|想到/.test(text) ? 0.25 : 0;
  const punctuationScore = Math.min(0.25, (text.match(/[，。！？；：“”‘’]/g) || []).length / 20);
  return Number((lengthScore * 0.45 + signalScore * 0.2 + actionScore + punctuationScore).toFixed(4));
}

/** 按可核验热度、平台覆盖、完结状态和授权状态给作品生成确定性选样分数。
 * 参数：record 为来源或 manifest 作品记录；config 为配额配置。
 * 返回值：包含总分和各组成项的选样评分对象；缺少热度证据时热度项为零。
 */
function scoreWorkForSelection(record, config = {}) {
  const source = record && typeof record === 'object' ? record : {};
  const normalized = source.work_title || source.candidate_title || source.url || source.novelid != null
    ? normalizeSourceRecord(source)
    : source;
  const ranking = normalizeRanking(normalized);
  const rankValues = Object.values(ranking.ranks || {}).filter(value => Number.isFinite(Number(value)) && Number(value) > 0).map(Number);
  const bestRank = rankValues.length ? Math.min(...rankValues) : 0;
  const rankingEvidence = Boolean(bestRank && ranking.capturedAt && ranking.evidenceRef && ranking.evidenceVerified === true);
  const heatScore = rankingEvidence ? Number((1 / Math.log2(bestRank + 1)).toFixed(6)) : 0;
  const preferred = Array.isArray(config.preferredPlatforms) ? config.preferredPlatforms : [];
  const platform = String(normalized.platform || source.platform || '').trim();
  const platformIndex = preferred.indexOf(platform);
  const platformScore = platformIndex < 0 ? 0 : Number(((preferred.length - platformIndex) / Math.max(1, preferred.length)).toFixed(6));
  const completionScore = normalizeCompletionStatus(normalized.completionStatus || source.completionStatus || source.work_status || '') === 'completed' ? 1 : 0;
  const authorizationScore = evaluateAuthorization(normalized.authorization || source.authorization, config.authorizationPolicy || {}).usable ? 1 : 0;
  const genreScore = String(normalized.primaryGenre || source.primaryGenre || '').trim() ? 1 : 0;
  const score = Number((heatScore * 0.55 + platformScore * 0.1 + completionScore * 0.15 + authorizationScore * 0.15 + genreScore * 0.05).toFixed(6));
  return {
    score,
    heatScore,
    rankingEvidence,
    bestRank,
    platformScore,
    completionScore,
    authorizationScore,
    genreScore
  };
}

/** 为候选样本提供稳定的选样排序，热度优先后再按教学价值和样本键打破平局。
 * 参数：left、right 为候选样本；config 为配额配置。
 * 返回值：可直接传给 Array.prototype.sort 的比较结果。
 */
function compareSelectionRows(left, right, config = {}) {
  const leftWorkScore = Number(left.selectionScore?.score ?? scoreWorkForSelection(left, config).score);
  const rightWorkScore = Number(right.selectionScore?.score ?? scoreWorkForSelection(right, config).score);
  const leftSampleScore = Number(left.score || 0);
  const rightSampleScore = Number(right.score || 0);
  return rightWorkScore - leftWorkScore
    || rightSampleScore - leftSampleScore
    || String(left.sampleKey || left.candidateId || '').localeCompare(String(right.sampleKey || right.candidateId || ''), 'en');
}

/** 校验配额配置的结构、维度数量和数值范围，避免错误配置静默进入建库。
 * 参数：value 为待校验的配额配置对象。
 * 返回值：包含 valid 和 errors 的校验结果。
 */
function validateQuotaConfig(value, options = {}) {
  const config = value && typeof value === 'object' ? value : {};
  const production = options.production !== false;
  const errors = [];
  const archetypes = Array.isArray(config.archetypes) ? config.archetypes : [];
  const buckets = config.genreBuckets && typeof config.genreBuckets === 'object' && !Array.isArray(config.genreBuckets)
    ? Object.keys(config.genreBuckets)
    : [];
  if (archetypes.length !== ARCHETYPES.length || new Set(archetypes).size !== archetypes.length || !ARCHETYPES.every(item => archetypes.includes(item))) errors.push('archetypes 必须包含十个不重复人物类型');
  if (buckets.length !== Object.keys(DEFAULT_GENRE_BUCKETS).length || new Set(buckets).size !== buckets.length || !Object.keys(DEFAULT_GENRE_BUCKETS).every(item => buckets.includes(item))) errors.push('genreBuckets 必须包含四个不重复题材桶');
  if (!Array.isArray(config.rawGenres) || config.rawGenres.length !== 18 || new Set(config.rawGenres).size !== config.rawGenres.length) errors.push('rawGenres 必须包含十八个不重复原题材');
  const sourceBucketMap = config.sourceBucketMap && typeof config.sourceBucketMap === 'object' && !Array.isArray(config.sourceBucketMap) ? config.sourceBucketMap : {};
  if (!Array.isArray(config.rawGenres) || config.rawGenres.some(genre => !Object.prototype.hasOwnProperty.call(sourceBucketMap, genre))) errors.push('sourceBucketMap 必须覆盖每个原题材');
  if (Object.values(sourceBucketMap).some(bucket => bucket !== null && !buckets.includes(bucket))) errors.push('sourceBucketMap 含有未知题材桶');
  const declaredBucketGenres = new Set(Object.values(config.genreBuckets || {}).flatMap(genres => Array.isArray(genres) ? genres : []));
  if (Array.isArray(config.rawGenres)) {
    for (const genre of config.rawGenres) {
      const bucket = sourceBucketMap[genre];
      if (bucket !== null && !declaredBucketGenres.has(genre)) errors.push(`sourceBucketMap 的反向映射未在题材桶声明：${genre} -> ${bucket}`);
    }
  }
  const archiveGroupMap = config.archiveGroupMap && typeof config.archiveGroupMap === 'object' && !Array.isArray(config.archiveGroupMap)
    ? config.archiveGroupMap
    : {};
  if (Array.isArray(config.rawGenres)) {
    for (const genre of config.rawGenres) {
      const archiveGroup = String(archiveGroupMap[genre] || '').trim().replace(/\\/gu, '/');
      if (!archiveGroup || archiveGroup.startsWith('/') || archiveGroup.includes('..')) errors.push(`archiveGroupMap 缺少安全归档组：${genre}`);
    }
  }
  const rawGenreAliases = config.rawGenreAliases && typeof config.rawGenreAliases === 'object' && !Array.isArray(config.rawGenreAliases) ? config.rawGenreAliases : {};
  for (const [alias, target] of Object.entries(rawGenreAliases)) {
    const canonical = canonicalizeRawGenre(target, config);
    if (!String(alias || '').trim() || !canonical || !Array.isArray(config.rawGenres) || !config.rawGenres.includes(canonical)) {
      errors.push(`rawGenreAliases 包含无法归一化到 18 类的标签：${alias}`);
    }
  }
  if (!['tagged', 'primary', 'primary-or-explicit'].includes(config.rawGenreCountMode || 'tagged')) errors.push('rawGenreCountMode 必须是 tagged、primary 或 primary-or-explicit');
  if (!['orthogonal', 'tagged'].includes(config.rawGenreProfileMode || 'orthogonal')) errors.push('rawGenreProfileMode 必须是 orthogonal 或 tagged');
  for (const slice of Array.isArray(config.focusSlices) ? config.focusSlices : []) {
    const match = String(slice?.genreMatch || 'all').toLowerCase();
    if (!['all', 'any', 'at_least'].includes(match)) errors.push(`focusSlice ${slice?.id || 'unknown'} 的 genreMatch 无效`);
    if (match === 'at_least' && (!Number.isInteger(Number(slice?.minimumGenreHits)) || Number(slice.minimumGenreHits) < 1)) {
      errors.push(`focusSlice ${slice?.id || 'unknown'} 的 minimumGenreHits 必须是正整数`);
    }
  }
  const positive = (key, fallback) => Number(config[key] ?? fallback);
  if (!(positive('cellMinChars', 25000) > 0)) errors.push('cellMinChars 必须大于 0');
  if (!(positive('cellHardFloor', 12000) > 0 && positive('cellHardFloor', 12000) <= positive('cellMinChars', 25000))) errors.push('cellHardFloor 必须不大于 cellMinChars');
  if (!(positive('perBookCellCapPct', 0.15) > 0 && positive('perBookCellCapPct', 0.15) <= 1)) errors.push('perBookCellCapPct 必须在 0 和 1 之间');
  const range = Array.isArray(config.bucketTargetRange) ? config.bucketTargetRange : [];
  if (range.length !== 2 || range.some(value => !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1) || Number(range[0]) > Number(range[1])) errors.push('bucketTargetRange 必须是合法的递增比例区间');
  if (!(positive('uniqueUsableBookTarget', 100) > 0)) errors.push('uniqueUsableBookTarget 必须大于 0');
  for (const [key, label] of [['rawGenreMinimumSampleChars', 'rawGenreMinimumSampleChars'], ['rawGenreMinimumSampleWorks', 'rawGenreMinimumSampleWorks'], ['rawGenreMinimumSampleCount', 'rawGenreMinimumSampleCount']]) {
    if (!(Number.isFinite(Number(config[key] ?? 0)) && Number(config[key] ?? 0) >= 0)) errors.push(`${label} 必须是不小于 0 的数字`);
  }
  for (const [key, label] of [['publishedMinimumDimensionChars', 'publishedMinimumDimensionChars'], ['publishedMinimumDimensionSamples', 'publishedMinimumDimensionSamples'], ['publishedMinimumDimensionWorks', 'publishedMinimumDimensionWorks']]) {
    if (!(Number.isFinite(Number(config[key] ?? 1)) && Number(config[key] ?? 1) >= 1)) errors.push(`${label} 必须是不小于 1 的数字`);
  }
  for (const [key, label] of [['rawGenreProfileMinimumChars', 'rawGenreProfileMinimumChars'], ['rawGenreProfileMinimumSamples', 'rawGenreProfileMinimumSamples'], ['rawGenreProfileMinimumWorks', 'rawGenreProfileMinimumWorks'], ['rawGenreProfileMinimumDimensionChars', 'rawGenreProfileMinimumDimensionChars'], ['rawGenreProfileMinimumDimensionSamples', 'rawGenreProfileMinimumDimensionSamples'], ['rawGenreProfileMinimumDimensionWorks', 'rawGenreProfileMinimumDimensionWorks']]) {
    if (!(Number.isFinite(Number(config[key] ?? 1)) && Number(config[key] ?? 1) >= 1)) errors.push(`${label} 必须是不小于 1 的数字`);
  }
  const requiredBooleanKeys = [
    'rawGenreRequiresUsableArchive', 'rawGenreRequiresDistinctPrimary', 'requireCompletedWork',
    'requireFullWork', 'requireDeclaredChapterCount', 'requireCompletionEvidence',
    'requireCompletionEvidenceVerification', 'requireFullWorkEvidence', 'requireContentHash', 'requireChapterSetEvidence', 'requireChapterOrderEvidence', 'requireRankingEvidence'
  ];
  for (const key of requiredBooleanKeys) {
    if (typeof config[key] !== 'boolean') errors.push(`${key} 必须是布尔值`);
    else if (production && config[key] !== true) errors.push(`${key} 必须为 true`);
  }
  const rawGenreTargetBooks = Number(config.rawGenreTargetBooks);
  const uniqueUsableBookTarget = Number(config.uniqueUsableBookTarget);
  if (!Number.isInteger(rawGenreTargetBooks) || rawGenreTargetBooks < (production ? 20 : 1)) errors.push(`rawGenreTargetBooks 必须是不小于 ${production ? 20 : 1} 的整数`);
  if (!Number.isInteger(uniqueUsableBookTarget) || uniqueUsableBookTarget < (production ? rawGenreTargetBooks * 18 : 1)) errors.push('uniqueUsableBookTarget 不足或不是整数');
  if (!['tagged', 'primary', 'primary-or-explicit'].includes(config.rawGenreCountMode)) errors.push('rawGenreCountMode 无效');
  if (production && config.rawGenreCountMode !== 'primary') errors.push('rawGenreCountMode 必须为 primary，避免一部作品填充多个原题材配额');
  if (production && config.rawGenreRequiresDistinctPrimary !== true) errors.push('rawGenreRequiresDistinctPrimary 必须为 true');
  if (production && Number(config.rawGenreMinimumSampleWorks) < rawGenreTargetBooks) errors.push('rawGenreMinimumSampleWorks 必须不小于 rawGenreTargetBooks');
  if (production && Number(config.rawGenreMinimumSampleCount) < rawGenreTargetBooks) errors.push('rawGenreMinimumSampleCount 必须不小于 rawGenreTargetBooks');
  if (!['orthogonal', 'tagged'].includes(config.rawGenreProfileMode)) errors.push('rawGenreProfileMode 无效');
  if (production && config.rawGenreProfileMode !== 'orthogonal') errors.push('rawGenreProfileMode 必须为 orthogonal');
  const qualityGates = config.qualityGates && typeof config.qualityGates === 'object' ? config.qualityGates : {};
  for (const [key, minimum] of [['fanfictionSampleChars', 1], ['fanfictionMinDistinctNames', 1], ['forumSampleChars', 1], ['forumFeatureDensityPerKChars', 0], ['shortChapterChars', 1], ['shortChapterRun', 1], ['shortChapterRelativeToMean', 0]]) {
    if (!(Number.isFinite(Number(qualityGates[key])) && Number(qualityGates[key]) >= minimum)) errors.push(`qualityGates.${key} 数值无效`);
  }
  const authorizationPolicy = config.authorizationPolicy && typeof config.authorizationPolicy === 'object' ? config.authorizationPolicy : {};
  if (production && authorizationPolicy.requiredForArchiveUse !== true) errors.push('authorizationPolicy.requiredForArchiveUse 必须为 true');
  if (production && authorizationPolicy.requireVerifiedEvidence !== true) errors.push('authorizationPolicy.requireVerifiedEvidence 必须为 true');
  if (production && !String(authorizationPolicy.requiredScope || '').trim()) errors.push('authorizationPolicy.requiredScope 不能为空');
  if (production && (!Array.isArray(authorizationPolicy.allowedStatuses) || authorizationPolicy.allowedStatuses.length === 0)) errors.push('authorizationPolicy.allowedStatuses 不能为空');
  if (authorizationPolicy.requiredPermissions !== undefined && (!Array.isArray(authorizationPolicy.requiredPermissions) || authorizationPolicy.requiredPermissions.some(value => !['archiveUseAllowed', 'modelProcessingAllowed', 'runtimeUseAllowed', 'redistributionAllowed'].includes(String(value || '').replace(/^authorization\./u, ''))))) {
    errors.push('authorizationPolicy.requiredPermissions 只能包含已知用途权限');
  }
  for (const permission of production ? ['archiveUseAllowed', 'modelProcessingAllowed', 'runtimeUseAllowed'] : []) {
    if (!Array.isArray(authorizationPolicy.requiredPermissions) || !authorizationPolicy.requiredPermissions.includes(permission)) {
      errors.push(`authorizationPolicy.requiredPermissions 必须包含 ${permission}`);
    }
  }
  const modelReview = config.modelReview && typeof config.modelReview === 'object' ? config.modelReview : {};
  if (production && modelReview.required !== true) errors.push('modelReview.required 必须为 true');
  if (!(Number.isFinite(Number(modelReview.minConfidence)) && Number(modelReview.minConfidence) >= (production ? 0.8 : 0) && Number(modelReview.minConfidence) <= 1)) errors.push(`modelReview.minConfidence 必须在 ${production ? 0.8 : 0} 到 1 之间`);
  if (production && modelReview.requireInputBinding !== true) errors.push('modelReview.requireInputBinding 必须为 true');
  if (production && modelReview.requireEvidenceSpans !== true) errors.push('modelReview.requireEvidenceSpans 必须为 true');
  const characterEvidence = config.characterEvidence && typeof config.characterEvidence === 'object' ? config.characterEvidence : {};
  if (production && (characterEvidence.required !== true || characterEvidence.requireConfirmedEntity !== true)) errors.push('characterEvidence 必须要求已确认的人物实体');
  if (!Number.isInteger(Number(characterEvidence.catchphraseMinimumChapters)) || Number(characterEvidence.catchphraseMinimumChapters) < (production ? 3 : 1)) errors.push(`characterEvidence.catchphraseMinimumChapters 必须不小于 ${production ? 3 : 1}`);
  const platformCoverage = config.platformCoverage && typeof config.platformCoverage === 'object' ? config.platformCoverage : {};
  if (production && platformCoverage.enforce !== true) errors.push('platformCoverage.enforce 必须为 true');
  if (production && (!Array.isArray(platformCoverage.requiredForFocusSlices) || platformCoverage.requiredForFocusSlices.length === 0)) errors.push('platformCoverage.requiredForFocusSlices 不能为空');
  if (production && (!Number.isInteger(Number(platformCoverage.minimumFocusSliceWorks)) || Number(platformCoverage.minimumFocusSliceWorks) < 1)) errors.push('platformCoverage.minimumFocusSliceWorks 必须为正整数');
  if (production && (!Number.isInteger(Number(platformCoverage.minimumFocusSliceWorksPerPlatform)) || Number(platformCoverage.minimumFocusSliceWorksPerPlatform) < 1)) errors.push('platformCoverage.minimumFocusSliceWorksPerPlatform 必须为正整数');
  if (production && (!Number.isInteger(Number(platformCoverage.minimumFocusSliceChars)) || Number(platformCoverage.minimumFocusSliceChars) < 1)) errors.push('platformCoverage.minimumFocusSliceChars 必须为正整数');
  if (production && (!Array.isArray(config.focusSlices) || config.focusSlices.length === 0)) errors.push('focusSlices 不能为空');
  for (const slice of Array.isArray(config.focusSlices) ? config.focusSlices : []) {
    if (!String(slice?.runtimeKey || '').trim()) errors.push(`focusSlice ${slice?.id || 'unknown'} 必须有 runtimeKey`);
    if (production && slice?.gate !== 'enforce') errors.push(`focusSlice ${slice?.id || 'unknown'} 的 gate 必须为 enforce`);
  }
  return { valid: errors.length === 0, errors };
}

/** 读取并严格校验配额配置，拒绝损坏、缺字段或被意外放宽的生产配置。
 * 参数：options 为建库命令选项，可包含 quotaConfig 路径。
 * 返回值：通过校验的配额配置对象；失败时抛出带路径和字段错误的异常。
 */
function loadQuotaConfig(options = {}) {
  if (options.quotaConfigValue && typeof options.quotaConfigValue === 'object') {
    const validation = validateQuotaConfig(options.quotaConfigValue);
    if (!validation.valid) throw new Error(`配额配置无效：${validation.errors.join('；')}`);
    return options.quotaConfigValue;
  }
  const filePath = options.quotaConfig || DEFAULT_QUOTA_CONFIG;
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取配额配置：${filePath}；${error.message}`);
  }
  const validation = validateQuotaConfig(value);
  if (!validation.valid) throw new Error(`配额配置无效：${filePath}；${validation.errors.join('；')}`);
  return value;
}

/** 将原题材字符串映射为配额使用的四桶名称。
 * 参数：genre 为来源元数据中的原题材字符串，config 为配额配置。
 * 返回值：去重后的题材桶数组。
 */
function mapGenresToBuckets(genre, config) {
  const values = String(genre || '').split(/[、,，\s]+/).filter(Boolean);
  return [...new Set(values.map(value => config.sourceBucketMap?.[value]).filter(Boolean))];
}

/** 判断样本是否满足聚焦切片的题材命中数和受众条件。
 * 参数：sample 为已规范化样本；slice 为 quota-config.json 中的聚焦切片。
 * 返回值：样本属于该聚焦切片时返回 true。
 */
function matchesFocusSliceSample(sample, slice, config = {}) {
  const source = sample && typeof sample === 'object' ? sample : {};
  const target = slice && typeof slice === 'object' ? slice : {};
  const genres = canonicalizeRawGenres(source.rawGenres || splitRawGenres(source.genre), config);
  const sliceGenres = canonicalizeRawGenres(Array.isArray(target.genres) ? target.genres : [], config);
  const audienceMatches = target.requiresExplicitAudience !== true
    || (normalizeAudience(source.audience) && normalizeAudience(source.audience) === normalizeAudience(target.audience));
  const genreMatch = String(target.genreMatch || 'all').toLowerCase();
  const matchedGenreCount = sliceGenres.filter(genre => genres.includes(genre)).length;
  const minimumGenreHits = Math.min(
    sliceGenres.length,
    Math.max(1, Number(target.minimumGenreHits || 1))
  );
  const genreMatches = genreMatch === 'any'
    ? matchedGenreCount >= 1
    : genreMatch === 'at_least'
      ? matchedGenreCount >= minimumGenreHits
      : matchedGenreCount === sliceGenres.length;
  return Boolean(target.runtimeKey && sliceGenres.length > 0 && audienceMatches && genreMatches);
}

/** 判断样本是否应进入单独的原题材画像，默认按主归属保持 18 类统计互相正交。
 * 参数：sample 为已规范化样本；genre 为目标原题材；config 为配额配置。
 * 返回值：样本主归属符合目标题材时返回 true。
 */
function matchesRawGenreProfile(sample, genre, config = {}) {
  const source = sample && typeof sample === 'object' ? sample : {};
  const genres = canonicalizeRawGenres(source.rawGenres || splitRawGenres(source.genre), config);
  const primaryGenre = canonicalizeRawGenre(source.primaryGenre || (genres.length === 1 ? genres[0] : ''), config);
  const mode = String(config.rawGenreProfileMode || 'orthogonal').toLowerCase();
  return mode === 'tagged' ? genres.includes(genre) : primaryGenre === genre;
}

/** 将样本文本按中文句末标点切分，并过滤过短片段。
 * 参数：text 为原始样本文本。
 * 返回值：用于统计句长和标点节奏的句子数组。
 */
function splitProfileSentences(text) {
  return String(text || '')
    .split(/(?<=[。！？；])/u)
    .map(value => value.replace(/[\s\r\n]+/g, '').trim())
    .filter(value => value.length > 0);
}

/** 计算一组唯一文本的句长、标点、词汇和段落语感统计量。
 * 参数：texts 为已去重的中文样本文本数组；metadata 可提供样本作品、维度和平台信息。
 * 返回值：可直接写入索引 profiles 的统计画像对象。
 */
function calculateProfile(texts, metadata = {}) {
  const values = texts.map(value => String(value || '').replace(/[\s\r\n]+/g, '').trim()).filter(Boolean);
  const metadataSamples = Array.isArray(metadata.samples) ? metadata.samples : [];
  const sentences = values.flatMap(splitProfileSentences);
  const lengths = sentences.map(sentence => sentence.replace(/[“”‘’「」『』]/g, '').length).filter(Boolean);
  const sentenceMean = lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : 0;
  const sentenceVariance = lengths.length
    ? lengths.reduce((sum, value) => sum + ((value - sentenceMean) ** 2), 0) / lengths.length
    : 0;
  const commaCounts = sentences.map(sentence => (sentence.match(/，/g) || []).length);
  const commaHistogram = { '0': 0, '1': 0, '2': 0, '3': 0, '4+': 0 };
  for (const count of commaCounts) commaHistogram[count >= 4 ? '4+' : String(count)] += 1;
  const allText = values.join('');
  const kilo = Math.max(1, allText.length / 1000);
  const countMatches = pattern => (allText.match(pattern) || []).length;
  const isDialogueText = value => /^[“「『]/u.test(value) || /[“「『][^”」』]+[”」』]$/u.test(value);
  const dialogueTexts = values.filter(isDialogueText);
  const singleSentenceTexts = values.filter(value => splitProfileSentences(value).length <= 1);
  const reduplicationCount = countMatches(/([\u4e00-\u9fff])\1|([\u4e00-\u9fff]{2})\2/gu);
  const fourCharCount = FOUR_CHAR_TERMS.reduce((sum, term) => sum + countMatches(new RegExp(term, 'gu')), 0);
  const noPunctuationLongCount = values.filter(value => /[^。！？；，、：]{31,}/u.test(value)).length;
  const dialogueStates = values.map(value => isDialogueText(value) ? 'dialogue' : 'narration');
  const paragraphTransitions = dialogueStates.slice(1).filter((state, index) => state !== dialogueStates[index]).length;
  const sourceWorkCount = new Set(metadataSamples.map(sample => sample.sourceWork || logicalWorkId(sample, sample.sourceUrl)).filter(Boolean)).size;
  const dimensionCoverage = {};
  for (const sample of metadataSamples) {
    const dimensions = Array.isArray(sample.dimensions) && sample.dimensions.length
      ? sample.dimensions
      : [sample.dimension];
    for (const dimension of dimensions.map(value => String(value || '').trim()).filter(Boolean)) {
      dimensionCoverage[dimension] = (dimensionCoverage[dimension] || 0) + countCorpusChars(sample.text);
    }
  }
  const dimensionCount = Object.keys(dimensionCoverage).length;
  const platformCount = new Set(metadataSamples.map(sample => sample.platform).filter(Boolean)).size;
  const profile = {
    available: values.length > 0,
    sampleCount: values.length,
    charCount: allText.length,
    sentenceCount: lengths.length,
    sentenceMean: Number(sentenceMean.toFixed(2)),
    sentenceStd: Number(Math.sqrt(sentenceVariance).toFixed(2)),
    shortSentenceRatio: lengths.length ? Number((lengths.filter(value => value < 8).length / lengths.length).toFixed(4)) : 0,
    longSentenceRatio: lengths.length ? Number((lengths.filter(value => value > 40).length / lengths.length).toFixed(4)) : 0,
    commaPerSentence: commaCounts.length ? Number((commaCounts.reduce((sum, value) => sum + value, 0) / commaCounts.length).toFixed(2)) : 0,
    commaHistogram,
    enumerationPerKilo: Number((countMatches(/、/gu) / kilo).toFixed(4)),
    dashPerKilo: Number((countMatches(/[—-]/gu) / kilo).toFixed(4)),
    ellipsisPerKilo: Number((countMatches(/……|\.\.\./gu) / kilo).toFixed(4)),
    reduplicationPerKilo: Number((reduplicationCount / kilo).toFixed(4)),
    fourCharStructurePerKilo: Number((fourCharCount / kilo).toFixed(4)),
    measureWordPerKilo: Number(((allText.match(MEASURE_WORD_PATTERN) || []).length / kilo).toFixed(4)),
    noPunctuationLongRatio: Number((noPunctuationLongCount / Math.max(1, values.length)).toFixed(4)),
    singleSentenceParaRatio: values.length ? Number((singleSentenceTexts.length / values.length).toFixed(4)) : 0,
    dialogueRowRatio: values.length ? Number((dialogueTexts.length / values.length).toFixed(4)) : 0,
    dialogueNarrationAlternation: values.length > 1
      ? Number(Math.min(1, paragraphTransitions / (values.length - 1)).toFixed(4))
      : 0,
    sourceWorkCount,
    dimensionCoverage,
    dimensionCount,
    platformCount,
    basis: '唯一清洗样本；样本行作为段落代理；不含原文句子内容'
  };
  return profile;
}

/** 建立类型×题材桶画像及类型、题材桶聚合兜底画像。
 * 参数：parsedRows 为 Markdown 解析结果，config 为配额配置。
 * 返回值：profiles、唯一计量样本和重复诊断信息。
 */
function buildProfiles(parsedRows, config) {
  const unique = new Map();
  const mergeSample = (existing, row, rawGenres, bucket, sourceWork, text) => {
    const nextPrimaryGenre = canonicalizeRawGenre(row.primaryGenre || (rawGenres.length === 1 ? rawGenres[0] : ''), config);
    if (!existing) {
      return {
        ...row,
        bucket,
        sourceWork,
        sourceWorkId: row.sourceWorkId || sourceWork,
        canonicalWorkId: row.canonicalWorkId || sourceWork,
        rawGenres,
        primaryGenre: nextPrimaryGenre,
        text,
        dimensions: row.dimension ? [row.dimension] : []
      };
    }
    existing.rawGenres = [...new Set([...(existing.rawGenres || []), ...rawGenres])];
    if (existing.primaryGenre && nextPrimaryGenre && existing.primaryGenre !== nextPrimaryGenre) {
      existing.primaryGenre = '';
      existing.primaryGenreConflict = true;
    } else if (!existing.primaryGenre && nextPrimaryGenre && existing.primaryGenreConflict !== true) {
      existing.primaryGenre = nextPrimaryGenre;
    }
    existing.bucket = existing.primaryGenreConflict === true
      ? ''
      : primaryGenreBucket(existing.rawGenres, config, existing.primaryGenre);
    existing.dimensions = [...new Set([...(existing.dimensions || []), row.dimension].filter(Boolean))];
    existing.signals = [...new Set([...(existing.signals || []), ...(row.signals || [])])];
    return existing;
  };
  for (const row of parsedRows) {
    const rawGenres = canonicalizeRawGenres(row.rawGenres || splitRawGenres(row.genre), config);
    const primaryGenre = canonicalizeRawGenre(row.primaryGenre || (rawGenres.length === 1 ? rawGenres[0] : ''), config);
    const bucket = primaryGenreBucket(rawGenres, config, primaryGenre);
    const sourceWork = logicalWorkId(row, row.sourceUrl || `${row.title}|${row.author}`);
    const text = normalizeSourceText(row.text);
    const key = corpusSampleKey({ ...row, sourceWorkId: sourceWork }, text);
    unique.set(key, mergeSample(unique.get(key), row, rawGenres, bucket, sourceWork, text));
  }
  const allSamples = [...unique.values()].sort((left, right) => compareSelectionRows(left, right, config));
  const unmappedSamples = allSamples.filter(sample => !sample.bucket);
  const uncappedSamples = allSamples.filter(sample => sample.bucket);
  const capResult = selectPerBookCellCap(uncappedSamples, config);
  const samples = capResult.samples;
  const groups = new Map();
  const add = (key, sample) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  };
  for (const sample of samples) {
    add(`${sample.archetype}|${sample.bucket}`, sample);
    add(`${sample.archetype}|all`, sample);
    add(`all|${sample.bucket}`, sample);
    add('all|all', sample);
    for (const genre of Array.isArray(config.rawGenres) ? config.rawGenres : DEFAULT_RAW_GENRES) {
      if (!matchesRawGenreProfile(sample, genre, config)) continue;
      add(`${sample.archetype}|raw:${genre}`, sample);
      add(`all|raw:${genre}`, sample);
    }
    for (const slice of Array.isArray(config.focusSlices) ? config.focusSlices : []) {
      const sliceGenres = Array.isArray(slice.genres) ? slice.genres : [];
      if (slice.runtimeKey && sliceGenres.length > 0 && matchesFocusSliceSample(sample, slice, config)) {
        add(`${sample.archetype}|${slice.runtimeKey}`, sample);
        add(`all|${slice.runtimeKey}`, sample);
      }
    }
  }
  // 未映射原题材不进入四桶配额，但必须进入对应的 raw:原题材画像和原题材审计。
  for (const sample of unmappedSamples) {
    for (const genre of Array.isArray(config.rawGenres) ? config.rawGenres : DEFAULT_RAW_GENRES) {
      if (!matchesRawGenreProfile(sample, genre, config)) continue;
      add(`${sample.archetype}|raw:${genre}`, sample);
      add(`all|raw:${genre}`, sample);
    }
  }
  const profiles = {};
  const minimumProfileChars = Number(config.profileMinimumChars || config.cellHardFloor || 12000);
  const profileKeys = new Set();
  for (const archetype of [...config.archetypes || ARCHETYPES, 'all']) {
    for (const bucket of [...Object.keys(config.genreBuckets || DEFAULT_GENRE_BUCKETS), 'all']) {
      profileKeys.add(`${archetype}|${bucket}`);
    }
    for (const slice of Array.isArray(config.focusSlices) ? config.focusSlices : []) {
      if (slice.runtimeKey) profileKeys.add(`${archetype}|${slice.runtimeKey}`);
    }
    for (const genre of Array.isArray(config.rawGenres) ? config.rawGenres : DEFAULT_RAW_GENRES) {
      profileKeys.add(`${archetype}|raw:${genre}`);
    }
  }
  for (const key of profileKeys) {
      const group = groups.get(key) || [];
      const profile = calculateProfile(group.map(sample => sample.text), { samples: group });
      const dimensionSampleCoverage = {};
      const dimensionWorkCoverage = {};
      for (const sample of group) {
        const dimensions = Array.isArray(sample.dimensions) && sample.dimensions.length
          ? sample.dimensions
          : [sample.dimension];
        for (const dimension of dimensions.filter(Boolean)) {
          dimensionSampleCoverage[dimension] = (dimensionSampleCoverage[dimension] || 0) + 1;
          if (!dimensionWorkCoverage[dimension]) dimensionWorkCoverage[dimension] = new Set();
          dimensionWorkCoverage[dimension].add(sample.sourceWork);
        }
      }
      const dimensionWorkCounts = Object.fromEntries(Object.entries(dimensionWorkCoverage).map(([dimension, works]) => [dimension, works.size]));
      const reliabilityReasons = [];
      if (profile.charCount < minimumProfileChars) reliabilityReasons.push('char_count');
      if (profile.sourceWorkCount < Number(config.profileMinimumWorks || 0)) reliabilityReasons.push('source_work_count');
      if (profile.dimensionCount < Number(config.profileMinimumDimensions || 0)) reliabilityReasons.push('dimension_coverage');
      const minimumDimensionChars = Number(config.profileMinimumDimensionChars || 0);
      const minimumDimensionSamples = Number(config.profileMinimumDimensionSamples || 0);
      const minimumDimensionWorks = Number(config.profileMinimumDimensionWorks || 0);
      const dimensionRequirements = (config.profileMinimumDimensions || DIMENSIONS.length) > 0
        ? DIMENSIONS.map(([dimension]) => dimension)
        : [];
      const underrepresentedDimensions = dimensionRequirements.filter(dimension => (
        Number(profile.dimensionCoverage[dimension] || 0) < minimumDimensionChars
        || Number(dimensionSampleCoverage[dimension] || 0) < minimumDimensionSamples
        || Number(dimensionWorkCounts[dimension] || 0) < minimumDimensionWorks
      ));
      if (underrepresentedDimensions.length) reliabilityReasons.push('dimension_minimums');
      profiles[key] = {
         ...profile,
         reliable: profile.available && reliabilityReasons.length === 0,
         reliabilityReasons,
         dimensionSampleCoverage,
         dimensionWorkCounts,
         underrepresentedDimensions
      };
  }
  const rawGenreProfiles = Object.fromEntries(Object.entries(profiles).filter(([key]) => key.includes('|raw:')));
  const strictRawGenreProfiles = Object.fromEntries(Object.entries(rawGenreProfiles).filter(([key]) => !key.startsWith('all|')));
  const aggregateRawGenreProfiles = Object.fromEntries(Object.entries(rawGenreProfiles).filter(([key]) => key.startsWith('all|')));
  return {
    profiles,
    rawGenreProfiles,
    strictRawGenreProfiles,
    aggregateRawGenreProfiles,
    samples,
    uncappedSamples,
    capChars: capResult.capChars,
    capCells: capResult.cells,
    perBookCapViolations: capResult.perBookCapViolations,
    unmappedRows: unmappedSamples.length,
    unmappedSamples,
    minimumProfileChars,
    minimumProfileWorks: Number(config.profileMinimumWorks || 0),
    minimumProfileDimensions: Number(config.profileMinimumDimensions || 0),
    focusSlices: Array.isArray(config.focusSlices) ? config.focusSlices : []
  };
}

/** 统计全库和聚焦切片的平台分布，供平台覆盖发布门禁使用。
 * 参数：samples 为通过前置质量门禁的唯一样本；config 为配额配置。
 * 返回值：平台字数、作品数、单平台占比和聚焦切片缺口报告。
 */
function calculatePlatformCoverage(samples, config) {
  const rows = Array.isArray(samples) ? samples : [];
  const platformStats = selectedRows => {
    const values = Array.isArray(selectedRows) ? selectedRows : [];
    const works = new Set();
    const byPlatform = new Map();
    let charCount = 0;
    for (const sample of values) {
      const platform = String(sample.platform || '').trim() || '未标注';
      const chars = countCorpusChars(sample.text);
      const work = sample.sourceWork || logicalWorkId(sample, sample.sourceUrl || `${sample.title || ''}|${sample.author || ''}`);
      works.add(work);
      charCount += chars;
      if (!byPlatform.has(platform)) byPlatform.set(platform, { platform, charCount: 0, sampleCount: 0, works: new Set() });
      const stat = byPlatform.get(platform);
      stat.charCount += chars;
      stat.sampleCount += 1;
      stat.works.add(work);
    }
    const platformRows = [...byPlatform.values()].map(stat => ({
      platform: stat.platform,
      charCount: stat.charCount,
      sampleCount: stat.sampleCount,
      sourceWorkCount: stat.works.size,
      charShare: charCount ? Number((stat.charCount / charCount).toFixed(4)) : 0,
      workShare: works.size ? Number((stat.works.size / works.size).toFixed(4)) : 0
    })).sort((left, right) => right.charCount - left.charCount || left.platform.localeCompare(right.platform, 'zh-CN'));
    return {
      sampleCount: values.length,
      charCount,
      sourceWorkCount: works.size,
      platformCount: platformRows.length,
      untaggedSampleCount: platformRows.find(item => item.platform === '未标注')?.sampleCount || 0,
      platforms: platformRows,
      maxSinglePlatformShare: platformRows.length ? platformRows[0].charShare : 0
    };
  };
  const overall = platformStats(rows);
  const platformConfig = config.platformCoverage && typeof config.platformCoverage === 'object' ? config.platformCoverage : {};
  const requiredPlatforms = Array.isArray(platformConfig.requiredForFocusSlices)
    ? platformConfig.requiredForFocusSlices.map(value => String(value || '').trim()).filter(Boolean)
    : [];
  const focusSlices = (Array.isArray(config.focusSlices) ? config.focusSlices : []).map(slice => {
    const selected = rows.filter(sample => matchesFocusSliceSample(sample, slice, config));
    const stats = platformStats(selected);
    const required = [...new Set((Array.isArray(slice.platforms) ? slice.platforms : requiredPlatforms)
      .map(value => String(value || '').trim()).filter(Boolean))];
    const present = new Set(stats.platforms.map(item => item.platform));
    const missingPlatforms = required.filter(platform => !present.has(platform));
    const enforced = platformConfig.enforce === true && platformConfig.reportOnlyUntilEvidence !== true && slice.gate === 'enforce';
    const minimumWorks = Number(platformConfig.minimumFocusSliceWorks || 0);
    const minimumWorksPerPlatform = Number(platformConfig.minimumFocusSliceWorksPerPlatform || 0);
    const minimumChars = Number(platformConfig.minimumFocusSliceChars || 0);
    const minimumWorksPass = stats.sourceWorkCount >= minimumWorks;
    const minimumCharsPass = stats.charCount >= minimumChars;
    const platformWorkCounts = Object.fromEntries(required.map(platform => [
      platform,
      stats.platforms.find(item => item.platform === platform)?.sourceWorkCount || 0
    ]));
    const platformWorksPass = !minimumWorksPerPlatform
      || Object.values(platformWorkCounts).every(count => count >= minimumWorksPerPlatform);
    return {
      id: String(slice.id || ''),
      runtimeKey: String(slice.runtimeKey || ''),
      sampleCount: stats.sampleCount,
      charCount: stats.charCount,
      sourceWorkCount: stats.sourceWorkCount,
      platforms: stats.platforms,
      requiredPlatforms: required,
      missingPlatforms,
      minimumWorks,
      minimumWorksPerPlatform,
      minimumChars,
      minimumWorksPass,
      platformWorkCounts,
      platformWorksPass,
      minimumCharsPass,
      enforced,
      pass: !enforced || (missingPlatforms.length === 0 && minimumWorksPass && platformWorksPass && minimumCharsPass)
    };
  });
  const maxShare = Number(platformConfig.maxSinglePlatformShare);
  const maxSinglePlatformPass = !Number.isFinite(maxShare) || maxShare <= 0 || overall.maxSinglePlatformShare <= maxShare;
  const focusSlicePass = focusSlices.every(slice => slice.pass);
  const enforced = platformConfig.enforce === true && platformConfig.reportOnlyUntilEvidence !== true;
  return {
    enforced,
    maxSinglePlatformShare: Number.isFinite(maxShare) ? maxShare : null,
    maxSinglePlatformPass: !enforced || maxSinglePlatformPass,
    focusSlicePass: !enforced || focusSlicePass,
    pass: !enforced || (maxSinglePlatformPass && focusSlicePass),
    overall,
    focusSlices
  };
}

/** 依据画像样本计算配额交叉格、桶占比和单书贡献超限记录。
 * 参数：profileResult 为 buildProfiles 返回值，config 为配额配置。
 * 返回值：quality-report.json 的 quota 段对象。
 */
function buildQuotaReport(profileResult, config) {
  const capChars = Number(profileResult.capChars || Math.floor(Number(config.cellMinChars || 25000) * Number(config.perBookCellCapPct || 0.15)));
  const cells = [];
  for (const archetype of config.archetypes || ARCHETYPES) {
    for (const bucket of Object.keys(config.genreBuckets || DEFAULT_GENRE_BUCKETS)) {
      const cellKey = `${archetype}|${bucket}`;
      const selected = profileResult.samples.filter(sample => sample.archetype === archetype && sample.bucket === bucket);
      const byBook = new Map();
      for (const sample of selected) byBook.set(sample.sourceWork, (byBook.get(sample.sourceWork) || 0) + countCorpusChars(sample.text));
      const capCell = profileResult.capCells?.[cellKey] || {};
      const rawChars = Number(capCell.rawChars ?? 0);
      const chars = Number(capCell.effectiveChars ?? [...byBook.values()].reduce((sum, value) => sum + value, 0));
      const trimmedChars = Number(capCell.trimmedChars || Math.max(0, rawChars - chars));
      const profile = profileResult.profiles?.[cellKey] || {};
      const target = Number(config.cellMinChars || 25000);
      cells.push({
        archetype,
        bucket,
        chars,
        rawUniqueChars: rawChars,
        effectiveChars: chars,
        trimmedChars,
        targetChars: target,
        gapChars: Math.max(0, target - chars),
        status: chars >= target ? 'met' : chars >= Number(config.cellHardFloor || 12000) ? 'hard-floor' : 'gap',
        sampleCount: selected.length,
        sourceWorkCount: byBook.size,
        rawSampleCount: Number(capCell.rawSampleCount || selected.length),
        effectiveSampleCount: Number(capCell.effectiveSampleCount || selected.length),
        dimensionCount: Number(profile.dimensionCount || 0),
        dimensionCoverage: profile.dimensionCoverage || {},
        dimensionSampleCoverage: profile.dimensionSampleCoverage || {},
        dimensionWorkCounts: profile.dimensionWorkCounts || {},
        underrepresentedDimensions: profile.underrepresentedDimensions || [],
        reliable: profile.reliable === true,
        perBookCapChars: capChars,
        perBookEffectiveChars: Object.fromEntries([...byBook].map(([sourceWork, value]) => [sourceWork, value]))
      });
    }
  }
  const bucketTotals = Object.fromEntries(Object.keys(config.genreBuckets || DEFAULT_GENRE_BUCKETS).map(bucket => [bucket, 0]));
  for (const cell of cells) bucketTotals[cell.bucket] += cell.chars;
  const totalChars = Object.values(bucketTotals).reduce((sum, value) => sum + value, 0);
  const bucketBalance = Object.fromEntries(Object.entries(bucketTotals).map(([bucket, chars]) => [bucket, totalChars ? Number((chars / totalChars).toFixed(4)) : 0]));
  const byBucket = Object.fromEntries(Object.entries(bucketTotals).map(([bucket, chars]) => [bucket, {
    currentChars: chars,
    targetChars: Number(config.cellMinChars || 25000) * (config.archetypes || ARCHETYPES).length,
    share: bucketBalance[bucket]
  }]));
  const byArchetype = Object.fromEntries((config.archetypes || ARCHETYPES).map(archetype => {
    const currentChars = cells.filter(cell => cell.archetype === archetype).reduce((sum, cell) => sum + cell.chars, 0);
    return [archetype, {
      currentChars,
      targetChars: Number(config.archetypeMinChars || 100000),
      recommendedChars: Number(config.archetypeRecommendedChars || config.archetypeMinChars || 100000),
      gapChars: Math.max(0, Number(config.archetypeMinChars || 100000) - currentChars)
    }];
  }));
  return {
    configVersion: config.version || VERSION,
    cells,
    bucketBalance,
    perBookCapChars: capChars,
    perBookCapViolations: profileResult.perBookCapViolations || [],
    platformCoverage: calculatePlatformCoverage(profileResult.samples, config),
    hardFloorCells: cells.filter(cell => cell.status === 'hard-floor'),
    unmappedRows: profileResult.unmappedRows,
    totalUniqueChars: cells.reduce((sum, cell) => sum + cell.effectiveChars, 0),
    totalRawUniqueChars: cells.reduce((sum, cell) => sum + cell.rawUniqueChars, 0),
    totalTrimmedChars: cells.reduce((sum, cell) => sum + cell.trimmedChars, 0),
    summary: {
      totalCurrentChars: totalChars,
      totalGap: cells.reduce((sum, cell) => sum + cell.gapChars, 0),
      totalUniqueSamples: profileResult.samples.length,
      worstCells: [...cells].sort((left, right) => right.gapChars - left.gapChars).slice(0, 10),
      byBucket,
      byArchetype
    }
  };
}

/** 校验十类人物与十八个原题材的 raw 画像是否均有可运行的统计覆盖。
 * 参数：profileResult 为 buildProfiles 返回值；config 为配额配置。
 * 返回值：180 个 raw 画像格的字数、样本数、作品数、六维度和失败原因。
 */
function evaluateRawGenreProfiles(profileResult, config = {}) {
  const archetypes = Array.isArray(config.archetypes) ? config.archetypes : [];
  const genres = Array.isArray(config.rawGenres) ? config.rawGenres : [];
  if (!genres.length) return { enforced: false, pass: true, cellCount: 0, passedCellCount: 0, cells: [], reasons: [] };
  const profiles = profileResult?.profiles && typeof profileResult.profiles === 'object' ? profileResult.profiles : {};
  const minimumChars = Math.max(1, Number(config.rawGenreProfileMinimumChars ?? config.profileMinimumChars ?? config.cellHardFloor ?? 12000));
  const minimumSamples = Math.max(1, Number(config.rawGenreProfileMinimumSamples ?? config.profileMinimumSamples ?? 3));
  const minimumWorks = Math.max(1, Number(config.rawGenreProfileMinimumWorks ?? config.profileMinimumWorks ?? 8));
  const minimumDimensionChars = Math.max(1, Number(config.rawGenreProfileMinimumDimensionChars ?? config.profileMinimumDimensionChars ?? 1000));
  const minimumDimensionSamples = Math.max(1, Number(config.rawGenreProfileMinimumDimensionSamples ?? config.profileMinimumDimensionSamples ?? 3));
  const minimumDimensionWorks = Math.max(1, Number(config.rawGenreProfileMinimumDimensionWorks ?? config.profileMinimumDimensionWorks ?? 3));
  const cells = [];
  for (const archetype of archetypes) {
    for (const genre of genres) {
      const key = `${archetype}|raw:${genre}`;
      const profile = profiles[key] || null;
      const missing = [];
      if (!profile) missing.push('profile_missing');
      else {
        if (Number(profile.charCount || 0) < minimumChars) missing.push('char_count');
        if (Number(profile.sampleCount || 0) < minimumSamples) missing.push('sample_count');
        if (Number(profile.sourceWorkCount || 0) < minimumWorks) missing.push('source_work_count');
        if (profile.reliable !== true) missing.push('profile_unreliable');
        for (const [dimension] of DIMENSIONS) {
          if (Number(profile.dimensionCoverage?.[dimension] || 0) < minimumDimensionChars
            || Number(profile.dimensionSampleCoverage?.[dimension] || 0) < minimumDimensionSamples
            || Number(profile.dimensionWorkCounts?.[dimension] || 0) < minimumDimensionWorks) {
            missing.push(`dimension_${dimension}`);
          }
        }
      }
      cells.push({
        key,
        archetype,
        genre,
        chars: Number(profile?.charCount || 0),
        sampleCount: Number(profile?.sampleCount || 0),
        sourceWorkCount: Number(profile?.sourceWorkCount || 0),
        dimensionCoverage: profile?.dimensionCoverage || {},
        dimensionSampleCoverage: profile?.dimensionSampleCoverage || {},
        dimensionWorkCounts: profile?.dimensionWorkCounts || {},
        reliable: profile?.reliable === true,
        status: missing.length ? 'gap' : 'met',
        reasons: [...new Set(missing)]
      });
    }
  }
  const passedCellCount = cells.filter(cell => cell.status === 'met').length;
  return {
    enforced: true,
    pass: cells.length > 0 && passedCellCount === cells.length,
    cellCount: cells.length,
    passedCellCount,
    minimums: {
      chars: minimumChars,
      samples: minimumSamples,
      works: minimumWorks,
      dimensionChars: minimumDimensionChars,
      dimensionSamples: minimumDimensionSamples,
      dimensionWorks: minimumDimensionWorks
    },
    cells,
    reasons: [...new Set(cells.flatMap(cell => cell.reasons))]
  };
}

/** 依据交叉格、桶均衡和原题材归档覆盖判断统计画像是否可发布。
 * 参数：quota 为 buildQuotaReport 结果；rawGenreCoverage 为原题材覆盖报告；config 为配额配置；profileResult 为画像构建结果。
 * 返回值：包含发布布尔值、失败原因和逐项门禁结果的对象。
 */
function evaluateProfileRelease(quota, rawGenreCoverage, config, profileResult = null) {
  const rawProfileCoverage = evaluateRawGenreProfiles(profileResult, config);
  const range = Array.isArray(config.bucketTargetRange) ? config.bucketTargetRange : [0.2, 0.3];
  const cellsPass = quota.cells.every(cell => cell.status === 'met' && cell.sampleCount > 0);
  const dimensionPass = quota.cells.every(cell => cell.dimensionCount >= Number(config.profileMinimumDimensions || DIMENSIONS.length));
  const reliablePass = quota.cells.every(cell => cell.reliable === true);
  const bucketPass = Object.values(quota.bucketBalance || {}).every(share => share >= range[0] && share <= range[1]);
  const capPass = Array.isArray(quota.perBookCapViolations) && quota.perBookCapViolations.length === 0;
  const platformCoverage = quota.platformCoverage && typeof quota.platformCoverage === 'object'
    ? quota.platformCoverage
    : null;
  const platformCoveragePass = platformCoverage?.pass === true;
  const rawGenres = rawGenreCoverage?.byGenre && typeof rawGenreCoverage.byGenre === 'object'
    ? Object.values(rawGenreCoverage.byGenre)
    : [];
  const rawArchivePass = config.rawGenreRequiresUsableArchive === false
    || (rawGenres.length > 0 && rawGenres.every(item => (item.archiveStatus || item.status) === 'met'));
  const rawSamplePass = rawGenres.length > 0 && rawGenres.every(item => !item.sampleStatus || item.sampleStatus === 'met');
  const rawGenrePass = rawGenres.length > 0 && rawGenres.every(item => item.status === 'met');
  const canonicalDedup = rawGenreCoverage?.canonicalDedup && typeof rawGenreCoverage.canonicalDedup === 'object'
    ? rawGenreCoverage.canonicalDedup
    : null;
  const canonicalDedupPass = !canonicalDedup?.enforced || canonicalDedup.pass === true;
  const rawProfileGateEnforced = config.enforceRawGenreProfileRelease === true;
  const rawProfileDiagnosticPass = rawProfileCoverage.pass;
  const rawProfilePass = !rawProfileGateEnforced || rawProfileDiagnosticPass;
  const uniqueUsableBookTarget = Number(config.uniqueUsableBookTarget || 100);
  const uniqueUsableBookPass = Number(rawGenreCoverage?.uniqueUsableArchiveWorkCount || 0) >= uniqueUsableBookTarget;
  const reasons = [];
  if (!cellsPass) reasons.push('cross_cell_quota');
  if (!dimensionPass) reasons.push('dimension_coverage');
  if (!reliablePass) reasons.push('profile_reliability');
  if (!bucketPass) reasons.push('bucket_balance');
  if (!capPass) reasons.push('per_book_cap');
  if (!platformCoveragePass) reasons.push('platform_coverage');
  if (!uniqueUsableBookPass) reasons.push('unique_usable_books');
  if (!rawArchivePass) reasons.push('raw_genre_archive_coverage');
  if (!rawSamplePass) reasons.push('raw_genre_sample_coverage');
  if (!rawGenrePass) reasons.push('raw_genre_coverage');
  if (rawProfileGateEnforced && !rawProfilePass) reasons.push('raw_genre_profile_coverage');
  if (!canonicalDedupPass) reasons.push('canonical_work_id_dedup');
  return {
    pass: reasons.length === 0,
    cellsPass,
    dimensionPass,
    reliablePass,
    bucketPass,
    capPass,
    platformCoveragePass,
    platformCoverage,
    uniqueUsableBookPass,
    uniqueUsableBookTarget,
    uniqueUsableBookCount: Number(rawGenreCoverage?.uniqueUsableArchiveWorkCount || 0),
    rawArchivePass,
    rawSamplePass,
    rawGenrePass,
    rawProfilePass,
    rawProfileGateEnforced,
    rawProfileDiagnosticPass,
    rawProfileCoverage,
    canonicalDedupPass,
    canonicalDedup,
    reasons,
    policy: '硬发布门禁要求四桶画像、原题材作品覆盖和可用原书；稀疏原题材画像默认只作为诊断，只有显式开启 enforceRawGenreProfileRelease 才阻断发布'
  };
}

/** Create a stable source hash that does not expose the original URL to the model. */
function sourceHash(row) {
  return crypto.createHash('sha256').update([row.canonicalWorkId || '', row.sourceWorkId || '', row.title, row.author, row.sourceUrl, row.genre].join('|')).digest('hex').slice(0, 16);
}

/** Build one executable rule card from a standard archetype and a description dimension. */
function buildRuleCard(archetype, dimension, index) {
  const label = DIMENSIONS.find(item => item[0] === dimension)[1];
  const pair = DIMENSION_RULES[dimension];
  return {
    id: `rule-${archetype.slice(0, 2)}-${dimension}-${index}`,
    archetype,
    dimension,
    rule: `${pair[0]} ${ARCHETYPE_HINTS[archetype] || '以可观察行为和场景结果呈现人物，而不是直接贴标签'}。`,
    application: pair[1],
    caution: '服从当前作品事实和场景证据，不把类型标签写成旁白结论。',
    scenes: ['当前人物有明确行动目标的场景', '人物关系或压力发生变化的场景'],
    signals: [label, archetype],
    score: 1
  };
}

/** Build generic rule cards used when no standard archetype can be inferred. */
function buildGenericRules() {
  return DIMENSIONS.map(([dimension], index) => ({
    ...buildRuleCard('通用', dimension, index + 1),
    archetype: '',
    id: `generic-rule-${index + 1}`
  }));
}

/** Generate a deterministic random sample list for the required 100-row manual audit. */
function selectAuditRows(rows, count = 100, seed = 20260825) {
  const values = rows.slice();
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values.slice(0, Math.min(count, values.length));
}

/** Load a completed human-audit manifest and require every selected row to be reviewed. */
function readManualAudit(options, auditRows) {
  const result = {
    file: options.auditFile || '',
    reviewedCount: 0,
    residualRate: null,
    rawResidualRate: null,
    excludedIds: [],
    complete: false,
    approved: false,
    reason: options.approve ? '缺少人工抽检清单' : '未请求发布 strong 样本'
  };
  if (!options.approve || !options.auditFile) return result;
  try {
    const manifest = JSON.parse(fs.readFileSync(options.auditFile, 'utf8'));
    const reviewedIds = new Set(Array.isArray(manifest.reviewedIds) ? manifest.reviewedIds.map(String) : []);
    const excludedIds = new Set((Array.isArray(manifest.excludedIds) ? manifest.excludedIds : manifest.residualIds || []).map(String));
    const complete = auditRows.length > 0 && auditRows.every(row => reviewedIds.has(String(row.id)));
    const publishableRows = auditRows.filter(row => !excludedIds.has(String(row.id)));
    const residualRows = publishableRows.filter(row => Array.isArray(row.residualTerms) && row.residualTerms.length > 0);
    const residualRate = publishableRows.length ? residualRows.length / publishableRows.length : 1;
    result.reviewedCount = reviewedIds.size;
    result.rawResidualRate = Number.isFinite(Number(manifest.residualRate)) ? Number(manifest.residualRate) : null;
    result.residualRate = Number(residualRate.toFixed(4));
    result.excludedIds = [...excludedIds].filter(id => auditRows.some(row => String(row.id) === id));
    result.complete = complete;
    result.approved = manifest.approved === true && complete && publishableRows.length > 0 && result.residualRate < 0.02;
    result.reason = result.approved
      ? '抽检完成，已剔除样本的剩余发布集专名残留率低于 2%'
      : !complete ? '人工抽检清单未覆盖全部抽检样本' : '人工抽检未达到发布阈值';
  } catch (error) {
    result.reason = '无法读取人工抽检清单：' + error.message;
  }
  return result;
}

/** 为最终发布建立包含描写维度的去重键，保留同一文本在不同维度中的合法分类。
 * 参数：row 为已匿名化的发布候选样本。
 * 返回值：包含基础样本键和维度的稳定字符串。
 */
function publicationSampleKey(row) {
  return `${row.sampleKey || corpusSampleKey(row, row.text)}|${row.dimension || ''}`;
}

/** 为发布统计建立跨维度去重键，按逻辑作品和规范化文本哈希识别同一段原文。
 * 参数：row 为候选样本行。
 * 返回值：用于配额字数去重的稳定字符串。
 */
function publicationTextKey(row) {
  const source = row && typeof row === 'object' ? row : {};
  const text = normalizeSourceText(source.text);
  const work = logicalWorkId(source, source.sourceUrl || `${source.title || ''}|${source.author || ''}`);
  return `${work}|${corpusTextHash(text)}`;
}

/** 按给定键保留发布统计中的首条样本，并把文本规范化为统一计量口径。
 * 参数：rows 为候选样本；keyBuilder 为可选的去重键函数。
 * 返回值：去重后的样本数组。
 */
function dedupePublicationRows(rows, keyBuilder = publicationTextKey) {
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const text = normalizeSourceText(row?.text);
    const key = keyBuilder(row);
    if (!unique.has(key)) unique.set(key, { ...row, text });
  }
  return [...unique.values()];
}

/** 选择最终样本时再次应用单书交叉格上限，确保画像、配额和 Markdown 使用同一口径。
 * 参数：rows 为已匿名化的候选样本；config 为配额配置。
 * 返回值：通过单书上限的样本数组及截断统计。
 */
function selectPublicationRows(rows, config) {
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const identity = publicationSampleKey(row);
    if (!unique.has(identity)) unique.set(identity, {
      ...row,
      bucket: row.genreBucket || primaryGenreBucket(row.rawGenres, config, row.primaryGenre),
      sourceWork: logicalWorkId(row, row.sourceUrl || `${row.title}|${row.author}`)
    });
  }
  const ordered = [...unique.values()].sort((left, right) => compareSelectionRows(left, right, config));
  const capped = selectPerBookCellCap(ordered, config, {
    resolveBucket: sample => sample.bucket,
    resolveIdentity: publicationSampleKey
  });
  const selectedIdentities = new Set(capped.samples.map(publicationSampleKey));
  return {
    rows: (Array.isArray(rows) ? rows : []).filter(row => selectedIdentities.has(publicationSampleKey(row))),
    cap: capped
  };
}

/** 统计最终 Markdown 发布池按主归属划分的十八个原题材覆盖，跨维度重复文本只计一次。
 * 参数：rows 为匿名化后的最终候选样本；config 为配额配置。
 * 返回值：每个原题材的独立作品数、样本数、字数和是否达到发布门槛。
 */
function calculateRawGenrePublicationCoverage(rows, config = {}) {
  const genres = Array.isArray(config.rawGenres) ? config.rawGenres : [];
  const states = new Map(genres.map(genre => [genre, { genre, chars: 0, sampleCount: 0, works: new Set(), samples: new Set() }]));
  for (const row of Array.isArray(rows) ? rows : []) {
    const work = logicalWorkId(row, row.sourceUrl || `${row.title || ''}|${row.author || ''}`);
    const text = normalizeSourceText(row.text);
    if (!work || !text) continue;
    const sampleKey = `${work}|${corpusTextHash(text)}`;
    for (const genre of genres) {
      if (!matchesRawGenreProfile(row, genre, config)) continue;
      const state = states.get(genre);
      if (!state || state.samples.has(sampleKey)) continue;
      state.samples.add(sampleKey);
      state.chars += countCorpusChars(text);
      state.sampleCount += 1;
      state.works.add(work);
    }
  }
  const minimumChars = Math.max(0, Number(config.rawGenreMinimumSampleChars || 0));
  const minimumSamples = Math.max(0, Number(config.rawGenreMinimumSampleCount || 0));
  const minimumWorks = Math.max(0, Number(config.rawGenreTargetBooks || config.rawGenreMinimumSampleWorks || 0));
  const byGenre = Object.fromEntries([...states].map(([genre, state]) => {
    const sourceWorkCount = state.works.size;
    const sampleStatus = state.chars >= minimumChars
      && state.sampleCount >= minimumSamples
      && sourceWorkCount >= minimumWorks;
    return [genre, {
      genre,
      chars: state.chars,
      sampleCount: state.sampleCount,
      sourceWorkCount,
      minimumChars,
      minimumSamples,
      minimumWorks,
      status: sampleStatus ? 'met' : 'gap'
    }];
  }));
  const values = Object.values(byGenre);
  return {
    enforced: genres.length > 0,
    pass: genres.length === 0 || values.every(item => item.status === 'met'),
    targetBooks: minimumWorks,
    minimumChars,
    minimumSamples,
    byGenre
  };
}

/** 统计最终 Markdown 候选的作品数、类型字数和六个描写维度覆盖。
 * 参数：rows 为经过匿名化和单书上限筛选的样本；config 为配额配置；options 可提供强审核池和实际发布池。
 * 返回值：供最终发布门禁和质量报告使用的分层字数统计对象。
 */
function calculatePublicationMetrics(rows, config, options = {}) {
  const candidateRows = Array.isArray(rows) ? rows : [];
  const strongApprovedRows = Array.isArray(options.strongApprovedRows) ? options.strongApprovedRows : [];
  const markdownPublishedRows = Array.isArray(options.markdownPublishedRows) ? options.markdownPublishedRows : [];
  const countChars = values => dedupePublicationRows(values).reduce((sum, row) => sum + countCorpusChars(row.text), 0);
  const uniqueCandidateRows = dedupePublicationRows(candidateRows);
  const uniqueArchetypeRows = dedupePublicationRows(candidateRows, row => `${row?.archetype || ''}|${publicationTextKey(row)}`);
  const uniqueDimensionRows = dedupePublicationRows(candidateRows, row => `${row?.archetype || ''}|${row?.dimension || ''}|${publicationTextKey(row)}`);
  const archetypeChars = Object.fromEntries((config.archetypes || ARCHETYPES).map(archetype => [archetype, 0]));
  const dimensionChars = Object.fromEntries((config.archetypes || ARCHETYPES).map(archetype => [archetype, Object.fromEntries(DIMENSIONS.map(([dimension]) => [dimension, 0]))]));
  const dimensionSamples = Object.fromEntries((config.archetypes || ARCHETYPES).map(archetype => [archetype, Object.fromEntries(DIMENSIONS.map(([dimension]) => [dimension, 0]))]));
  const dimensionWorks = Object.fromEntries((config.archetypes || ARCHETYPES).map(archetype => [archetype, Object.fromEntries(DIMENSIONS.map(([dimension]) => [dimension, new Set()]))]));
  const works = new Set();
  for (const row of uniqueArchetypeRows) {
    const archetype = String(row.archetype || '');
    const chars = countCorpusChars(row.text);
    if (Object.prototype.hasOwnProperty.call(archetypeChars, archetype)) archetypeChars[archetype] += chars;
  }
  for (const row of uniqueDimensionRows) {
    const archetype = String(row.archetype || '');
    const dimension = String(row.dimension || '');
    if (dimensionChars[archetype] && Object.prototype.hasOwnProperty.call(dimensionChars[archetype], dimension)) {
      dimensionChars[archetype][dimension] += countCorpusChars(row.text);
      dimensionSamples[archetype][dimension] += 1;
      dimensionWorks[archetype][dimension].add(logicalWorkId(row, row.sourceUrl || `${row.title || ''}|${row.author || ''}`));
    }
  }
  for (const row of uniqueCandidateRows) {
    if (row.sourceWorkId || row.canonicalWorkId || row.sourceUrl) works.add(logicalWorkId(row, row.sourceUrl));
  }
  const rawGenrePublication = calculateRawGenrePublicationCoverage(candidateRows, config);
  const minimumChars = config.publishedMinimumCharsByArchetype && typeof config.publishedMinimumCharsByArchetype === 'object'
    ? config.publishedMinimumCharsByArchetype
    : null;
  const defaultMinimum = Number(minimumChars ? 10000 : (config.publishedMinimumCharsByArchetype || 10000));
  const archetypeMinimums = Object.fromEntries((config.archetypes || ARCHETYPES).map(archetype => [archetype, Number(minimumChars?.[archetype] || defaultMinimum)]));
  const publishedMinimumDimensionChars = Number(config.publishedMinimumDimensionChars ?? 1);
  const publishedMinimumDimensionSamples = Number(config.publishedMinimumDimensionSamples ?? 1);
  const publishedMinimumDimensionWorks = Number(config.publishedMinimumDimensionWorks ?? 1);
  return {
    sampleCount: candidateRows.length,
    uniqueTextCount: uniqueCandidateRows.length,
    uniqueWorkCount: works.size,
    archetypeChars,
    archetypeMinimums,
    dimensionChars,
    dimensionSampleCounts: dimensionSamples,
    dimensionWorkCounts: Object.fromEntries((config.archetypes || ARCHETYPES).map(archetype => [archetype, Object.fromEntries(DIMENSIONS.map(([dimension]) => [dimension, dimensionWorks[archetype][dimension].size]))])),
    dimensionMinimums: {
      chars: publishedMinimumDimensionChars,
      samples: publishedMinimumDimensionSamples,
      works: publishedMinimumDimensionWorks
    },
    rawGenrePublication,
    strongApprovedChars: countChars(strongApprovedRows),
    publicationCandidateChars: countChars(candidateRows),
    markdownPublishedChars: countChars(markdownPublishedRows),
    // 兼容旧消费者：publishedChars 明确表示已写入发布 Markdown 的字数。
    publishedChars: countChars(markdownPublishedRows),
    totalChars: Object.values(archetypeChars).reduce((sum, value) => sum + value, 0)
  };
}

/** 汇总强样本、画像、作品数、类型字数和六维度覆盖的最终 Markdown 发布门禁。
 * 参数：strongSamplesPublished 表示人工与机器门禁是否通过；rows 为可发布候选；profileRelease 为画像门禁；config 为配额配置。
 * 返回值：发布布尔值、逐项门禁结果、失败原因和分层 Markdown 统计。
 */
function evaluateMarkdownPublication(strongSamplesPublished, rows, profileRelease, config, options = {}) {
  const strongApprovedRows = Array.isArray(options.strongApprovedRows)
    ? options.strongApprovedRows
    : strongSamplesPublished === true ? rows : [];
  const metrics = calculatePublicationMetrics(rows, config, { strongApprovedRows });
  const strongPass = strongSamplesPublished === true && metrics.sampleCount > 0;
  const archetypePass = (config.archetypes || ARCHETYPES).every(archetype => metrics.archetypeChars[archetype] >= metrics.archetypeMinimums[archetype]);
  const dimensionMinimums = metrics.dimensionMinimums || {};
  const dimensionPass = (config.archetypes || ARCHETYPES).every(archetype => DIMENSIONS.every(([dimension]) => (
    Number(metrics.dimensionChars[archetype]?.[dimension] || 0) >= Number(dimensionMinimums.chars ?? 1)
      && Number(metrics.dimensionSampleCounts?.[archetype]?.[dimension] || 0) >= Number(dimensionMinimums.samples ?? 1)
      && Number(metrics.dimensionWorkCounts?.[archetype]?.[dimension] || 0) >= Number(dimensionMinimums.works ?? 1)
  )));
  const uniqueWorkTarget = Number(config.uniqueUsableBookTarget || 100);
  const uniqueWorkPass = metrics.uniqueWorkCount >= uniqueWorkTarget;
  const rawGenrePass = metrics.rawGenrePublication?.pass === true;
  const profilePass = profileRelease?.pass === true;
  const reasons = [];
  if (!strongPass) reasons.push('strong_samples_not_published');
  if (!profilePass) reasons.push('profile_release');
  if (!uniqueWorkPass) reasons.push('published_unique_works');
  if (!archetypePass) reasons.push('published_archetype_chars');
  if (!dimensionPass) reasons.push('published_dimension_coverage');
  if (!rawGenrePass) reasons.push('published_raw_genre_coverage');
  const pass = reasons.length === 0;
  metrics.markdownPublishedChars = pass ? metrics.publicationCandidateChars : 0;
  metrics.publishedChars = metrics.markdownPublishedChars;
  return {
    pass,
    strongSamplesPass: strongPass,
    profilePass,
    uniqueWorkPass,
    uniqueWorkTarget,
    rawGenrePass,
    archetypePass,
    dimensionPass,
    reasons,
    metrics,
    policy: '只有授权、质量、匿名化、人工审核、画像和最终 Markdown 配额全部通过时才输出发布版原文样本'
  };
}

/** Build, filter, anonymize and version the runtime index from the raw Markdown corpus. */
function buildIndex(markdown, options = {}) {
  const sourceList = options.sourceList || readOptionalJson(options.sources || DEFAULT_SOURCES, { sources: [] });
  const sourceLookup = options.sourceLookup || buildUnifiedSourceLookup(sourceList);
  const archiveManifest = options.archiveManifest || readOptionalJson(DEFAULT_ARCHIVE_MANIFEST, null);
  const archiveIndex = buildArchiveEligibilityIndex(archiveManifest);
  const quotaConfig = loadQuotaConfig(options);
  const canonicalDedup = buildCanonicalDedupAudit(archiveManifest, quotaConfig);
  const canonicalDedupBlockedBookIds = new Set(canonicalDedup.issues.flatMap(issue => issue.bookIds));
  const rawClassificationCandidateRows = Array.isArray(options.classificationCandidateRows)
    ? options.classificationCandidateRows
    : (Array.isArray(options.archiveCandidateRows) ? options.archiveCandidateRows : []);
  const classificationCandidateRows = confirmCatchphraseRows(rawClassificationCandidateRows, quotaConfig);
  const archiveCandidateInput = Array.isArray(options.archiveCandidateRows)
    ? confirmCatchphraseRows(options.archiveCandidateRows, quotaConfig)
    : classificationCandidateRows;
  const archiveCandidateRows = archiveCandidateInput.filter(row => isApprovedArchiveCandidate(row, quotaConfig));
  const parsedRows = (Array.isArray(options.parsedRows) ? options.parsedRows : parseSourceMarkdown(markdown))
    .map(row => enrichCorpusRow(row, sourceLookup));
  const parsed = [...parsedRows, ...archiveCandidateRows];
  const configValidation = validateQuotaConfig(quotaConfig);
  const profileRows = [];
  // 人名词典：数据库真实人名 + 语料高频引号邻接组合，供匿名化精确替换
  const nameDictionary = new Set([
    ...(options.characterLibraryNames || []),
    ...scanCorpusNameCombos([markdown, ...archiveCandidateRows.map(row => row.text || '')].join('\n'))
  ]);
  const counts = {
    parsed: parsedRows.length,
    archiveCandidates: classificationCandidateRows.length,
    archiveCandidatesEligible: archiveCandidateRows.length,
    sensitive: 0,
    lowInformation: 0,
    duplicate: 0,
    residualNameCandidates: 0,
    published: 0,
    qaFeature: 0,
    discardedBroken: 0,
    archiveExcluded: 0,
    archiveExcludedReasons: {},
    provenanceExcluded: 0,
    provenanceExcludedReasons: {},
    characterEvidenceExcluded: 0,
    characterEvidenceExcludedReasons: {},
    unclassified: 0,
    strongApprovedChars: 0,
    publicationCandidateChars: 0,
    markdownPublishedChars: 0,
    publishedChars: 0
  };
  const classificationSummary = {
    mode: options.archiveCandidateClassificationMode || (archiveCandidateRows.length ? 'provided' : 'none'),
    candidateRows: classificationCandidateRows.length,
    eligibleRows: archiveCandidateRows.length,
    lexicalRows: classificationCandidateRows.filter(row => row.classification?.method === 'lexical').length,
    modelReviewedRows: classificationCandidateRows.filter(row => row.classification?.modelReview === 'approved').length,
    pendingModelReviewRows: classificationCandidateRows.filter(row => row.classification?.modelReview === 'pending').length,
    rejectedModelReviewRows: classificationCandidateRows.filter(row => row.classification?.modelReview === 'rejected').length,
    unclassifiedRows: classificationCandidateRows.filter(row => !row.archetype || !row.dimension).length,
    review: options.classificationReviewResult || null
  };
  const seenText = new Set();
  const safeRows = [];
  const matureRows = [];
  let checkedCount = 0;
  for (const row of parsed) {
    if (isLowInformationSample(row)) {
      counts.lowInformation += 1;
      continue;
    }
    // 阶段三 3.2：剔除论坛/问答体样本
    if (isQaSample(row)) {
      counts.qaFeature += 1;
      continue;
    }
    const archiveEligibility = checkArchiveEligibility(row, archiveIndex, quotaConfig);
    if (!archiveEligibility.usable) {
      counts.archiveExcluded += 1;
      counts.archiveExcludedReasons[archiveEligibility.reason] = (counts.archiveExcludedReasons[archiveEligibility.reason] || 0) + 1;
      continue;
    }
    if (canonicalDedup.enforced && archiveEligibility.book?.id && canonicalDedupBlockedBookIds.has(String(archiveEligibility.book.id))) {
      counts.archiveExcluded += 1;
      counts.archiveExcludedReasons.canonical_work_id_required = (counts.archiveExcludedReasons.canonical_work_id_required || 0) + 1;
      continue;
    }
    const provenance = verifyCandidateProvenance(row, archiveIndex, quotaConfig, archiveEligibility);
    if (!provenance.usable) {
      counts.provenanceExcluded += 1;
      counts.provenanceExcludedReasons[provenance.reason] = (counts.provenanceExcludedReasons[provenance.reason] || 0) + 1;
      continue;
    }
    if (!row.archetype) {
      counts.unclassified += 1;
      continue;
    }
    const characterEvidenceConfig = quotaConfig.characterEvidence && typeof quotaConfig.characterEvidence === 'object'
      ? quotaConfig.characterEvidence
      : {};
    if (characterEvidenceConfig.required === true && characterEvidenceConfig.requireConfirmedEntity === true) {
      const entityStatus = String(row.classification?.entityStatus || row.characterEvidence?.status || '').trim();
      const characterKey = String(row.classification?.characterKey || row.characterKey || '').trim();
      if (entityStatus !== 'confirmed' || !characterKey) {
        const reason = entityStatus !== 'confirmed' ? 'character_entity_unconfirmed' : 'character_key_missing';
        counts.characterEvidenceExcluded += 1;
        counts.characterEvidenceExcludedReasons[reason] = (counts.characterEvidenceExcludedReasons[reason] || 0) + 1;
        continue;
      }
    }
    const anonymized = anonymizeSample(row, nameDictionary);
    checkedCount += 1;
    // 阶段三 3.1：破坏自检，整条剔除破碎样本
    if (isBrokenAnonymization(anonymized.text)) {
      counts.discardedBroken += 1;
      continue;
    }
    const baseSampleKey = corpusSampleKey(row, row.text);
    const sampleKey = `${corpusSampleKey(row, anonymized.text)}|${row.dimension || ''}`;
    if (seenText.has(sampleKey)) {
      counts.duplicate += 1;
      continue;
    }
    seenText.add(sampleKey);
    profileRows.push({ ...row, sampleKey: baseSampleKey });
    const sensitive = SENSITIVE_PATTERN.test(row.text);
    if (sensitive) counts.sensitive += 1;
    const normalized = {
      id: `sample-${safeRows.length + matureRows.length + 1}`,
      archetype: row.archetype,
      dimension: row.dimension,
      corpus: sensitive ? 'mature' : 'general',
      text: anonymized.text,
      sourceHash: sourceHash(row),
      sourceWorkId: row.sourceWorkId,
      canonicalWorkId: row.canonicalWorkId || logicalWorkId(row),
      sourceNovelId: row.sourceNovelId,
      sampleKey: baseSampleKey,
      platform: row.platform,
      ranking: normalizeRanking(row),
      selectionScore: row.selectionScore || scoreWorkForSelection(row, quotaConfig),
      genre: row.genre,
      rawGenres: row.rawGenres,
      primaryGenre: canonicalizeRawGenre(row.primaryGenre || ((row.rawGenres || []).length === 1 ? row.rawGenres[0] : ''), quotaConfig),
       genreBucket: primaryGenreBucket(row.rawGenres, quotaConfig, row.primaryGenre),
      characterEvidence: summarizeCharacterEvidence({
        ...(row.characterEvidence || {}),
        status: row.classification?.entityStatus || row.characterEvidence?.status,
        evidenceSpans: row.classification?.evidenceSpans || row.characterEvidence?.evidenceSpans
      }),
      signals: row.signals,
      forbiddenTerms: anonymized.forbiddenTerms,
      residualTerms: anonymized.residualTerms,
      provenance: row.provenance || null,
      occurrences: candidateOccurrences(row),
      classification: row.classification || null,
      score: scoreSample(row, anonymized.text)
    };
    (sensitive ? matureRows : safeRows).push(normalized);
  }
  const auditSource = selectAuditRows([...safeRows, ...matureRows]);
  const residualCount = auditSource.filter(row => Array.isArray(row.residualTerms) && row.residualTerms.length > 0).length;
  const fullResidualRows = [...safeRows, ...matureRows].filter(row => Array.isArray(row.residualTerms) && row.residualTerms.length > 0);
  counts.residualNameCandidates = fullResidualRows.length;
  const residualRate = auditSource.length ? Number((residualCount / auditSource.length).toFixed(4)) : 0;
  const fullResidualRate = (safeRows.length + matureRows.length)
    ? Number((fullResidualRows.length / (safeRows.length + matureRows.length)).toFixed(4))
    : 0;
  const manualAudit = readManualAudit(options, auditSource);
  const excludedIds = new Set(manualAudit.excludedIds || []);
  const publishableAuditRows = auditSource.filter(row => !excludedIds.has(String(row.id)));
  const publishableResidualCount = publishableAuditRows.filter(row => Array.isArray(row.residualTerms) && row.residualTerms.length > 0).length;
  const publishableResidualRate = publishableAuditRows.length ? Number((publishableResidualCount / publishableAuditRows.length).toFixed(4)) : 1;
  manualAudit.residualRate = publishableResidualRate;
  manualAudit.excludedCount = excludedIds.size;
  const manualApproved = manualAudit.approved && publishableResidualRate < 0.02;
  // 机器门禁：破碎样本密度必须为 0，否则即便人工通过也不发布
  const brokenDensity = Number((counts.discardedBroken / Math.max(1, checkedCount)).toFixed(4));
  const machineGate = brokenDensity === 0;
  const strongSamplesPublished = machineGate && manualApproved;
  const profileResult = buildProfiles(profileRows, quotaConfig);
  const quota = buildQuotaReport(profileResult, quotaConfig);
  const rawGenreCoverage = calculateRawGenreCoverage(sourceList, quotaConfig, profileRows, archiveManifest);
  rawGenreCoverage.canonicalDedup = canonicalDedup;
  const profileRelease = evaluateProfileRelease(quota, rawGenreCoverage, quotaConfig, profileResult);
  const missingSourceMetadata = parsed.filter(row => {
    const byUrl = sourceLookup.get(row.sourceUrl);
    const byNovelId = row.sourceNovelId ? sourceLookup.get(`novel:${row.sourceNovelId}`) : null;
    return !byUrl && !byNovelId;
  }).length;
  const rules = [...ARCHETYPES.flatMap((archetype, typeIndex) => DIMENSIONS.map(([dimension], dimensionIndex) => buildRuleCard(archetype, dimension, typeIndex * DIMENSIONS.length + dimensionIndex + 1))), ...buildGenericRules()];
  /** Keep only samples with no detected proper-name residue in either corpus bucket. */
  const publishableSamples = rows => rows.filter(row => !excludedIds.has(String(row.id)) && (!Array.isArray(row.residualTerms) || row.residualTerms.length === 0));
  const publicationCandidateRows = selectPublicationRows(publishableSamples([...safeRows, ...matureRows]), quotaConfig).rows;
  const strongApprovedRows = strongSamplesPublished
    ? publishableSamples([...safeRows, ...matureRows])
    : [];
  const publicationGate = evaluateMarkdownPublication(strongSamplesPublished, publicationCandidateRows, profileRelease, quotaConfig, {
    strongApprovedRows
  });
  const markdownPublished = publicationGate.pass;
  // 阶段三 3.3：发布门禁——机器门禁与人工审核同时通过后才能真正发布 strong 样本
  const publishedRowIds = new Set(markdownPublished ? publicationCandidateRows.map(row => String(row.id)) : []);
  const publishedSamples = markdownPublished ? safeRows.filter(row => publishedRowIds.has(String(row.id))) : [];
  const publishedMatureSamples = markdownPublished ? matureRows.filter(row => publishedRowIds.has(String(row.id))) : [];
  counts.published = publishedSamples.length;
  counts.publishedMature = publishedMatureSamples.length;
  counts.strongApprovedChars = publicationGate.metrics.strongApprovedChars;
  counts.publicationCandidateChars = publicationGate.metrics.publicationCandidateChars;
  counts.markdownPublishedChars = publicationGate.metrics.markdownPublishedChars;
  counts.publishedChars = publicationGate.metrics.markdownPublishedChars;
  const inputHash = options.buildInputHash || crypto.createHash('sha256').update(markdown).digest('hex');
  return {
    index: {
      version: VERSION,
      published: markdownPublished,
      markdownPublished,
      sourceHash: inputHash,
      general: { rules, samples: publishedSamples },
      mature: { rules, samples: publishedMatureSamples },
      profiles: profileResult.profiles,
      rawGenreProfiles: profileResult.strictRawGenreProfiles,
      aggregateRawGenreProfiles: profileResult.aggregateRawGenreProfiles,
      profilesPublished: profileRelease.pass,
      profileFallback: quotaConfig.profileFallback || 'generic-rules',
      profileFocusSlices: profileResult.focusSlices,
      profileGenreMap: quotaConfig.sourceBucketMap || {},
      rawGenreCoverage,
      audit: {
        pipeline: ['parse', 'sensitive-filter', 'quality-filter', 'dedupe', 'anonymize', 'score', 'rule-distill', 'manual-sample-audit', 'broken-self-check'],
        manualReview: manualApproved,
        manualReviewRequired: true,
        auditSeed: 20260825,
        auditSampleCount: auditSource.length,
        sampleResidualRate: publishableResidualRate,
        rawSampleResidualRate: residualRate,
        strongSamplesPublished,
        markdownPublished,
        brokenDensity,
        machineGate,
        fullResidualRate,
        manualAudit,
        classification: classificationSummary,
        quota,
        profileRelease,
        publicationGate,
        configValidation
      }
    },
    report: {
      version: VERSION,
      sourceHash: inputHash,
      configValidation,
      counts,
      classification: classificationSummary,
      profiles: {
        uniqueSamples: profileResult.samples.length,
        uniqueChars: profileResult.samples.reduce((sum, sample) => sum + countCorpusChars(sample.text), 0),
        rawUniqueChars: profileResult.uncappedSamples.reduce((sum, sample) => sum + countCorpusChars(sample.text), 0),
        trimmedChars: profileResult.capCells
          ? Object.values(profileResult.capCells).reduce((sum, cell) => sum + Number(cell.trimmedChars || 0), 0)
          : 0,
        unmappedRows: profileResult.unmappedRows,
        minimumProfileChars: profileResult.minimumProfileChars,
        minimumProfileWorks: profileResult.minimumProfileWorks,
        minimumProfileDimensions: profileResult.minimumProfileDimensions,
         reliableCount: Object.values(profileResult.profiles).filter(profile => profile.reliable).length,
         rawGenreProfileCount: Object.keys(profileResult.strictRawGenreProfiles || {}).length,
         strictRawGenreProfileCount: Object.keys(profileResult.strictRawGenreProfiles || {}).length,
         aggregateRawGenreProfileCount: Object.keys(profileResult.aggregateRawGenreProfiles || {}).length,
         totalRawGenreProfileCount: Object.keys(profileResult.rawGenreProfiles || {}).length,
        focusSliceCount: profileResult.focusSlices.length,
        rawGenreOnlyRows: profileResult.unmappedSamples.length,
        rawGenreOnlyChars: profileResult.unmappedSamples.reduce((sum, sample) => sum + countCorpusChars(sample.text), 0),
        rawGenreOnlyWorks: new Set(profileResult.unmappedSamples.map(sample => logicalWorkId(sample, sample.sourceUrl)).filter(Boolean)).size
      },
      quota,
      profileRelease,
      publicationGate,
      rawGenreCoverage,
      source: {
        sourceRecordCount: Array.isArray(sourceList.sources) ? sourceList.sources.length : 0,
        legacyParsedWorks: new Set(parsedRows.map(row => logicalWorkId(row, row.sourceUrl))).size,
        candidateArchiveWorks: new Set(archiveCandidateRows.map(row => logicalWorkId(row, row.sourceUrl))).size,
        combinedLogicalWorks: new Set(parsed.map(row => logicalWorkId(row, row.sourceUrl))).size,
        uniqueMaterializedWorks: new Set(profileRows.map(row => logicalWorkId(row, row.sourceUrl))).size,
        archivedLogicalWorks: Array.isArray(archiveManifest?.books)
          ? new Set(archiveManifest.books.map(book => logicalWorkId(book, book.id)).filter(Boolean)).size
          : 0,
        archiveFileCount: Array.isArray(archiveManifest?.books)
          ? archiveManifest.books.reduce((sum, book) => sum + (Array.isArray(book.parts) && book.parts.length ? book.parts.length : 1), 0)
          : 0,
        usableArchiveWorks: Array.isArray(archiveManifest?.books)
          ? new Set(archiveManifest.books.filter(book => isUsableArchiveBook(book, quotaConfig)).map(book => logicalWorkId(book, book.id))).size
          : 0,
        publishedWorks: new Set(publicationCandidateRows.map(row => logicalWorkId(row, row.sourceUrl)).filter(Boolean)).size,
        archiveExcludedReasons: counts.archiveExcludedReasons,
        provenanceExcludedReasons: counts.provenanceExcludedReasons,
        characterEvidenceExcludedReasons: counts.characterEvidenceExcludedReasons,
        canonicalDedup,
        missingSourceMetadata,
        missingCanonicalWorkId: parsed.filter(row => row.canonicalWorkIdExplicit !== true).length,
        unresolvedSourceWorkId: parsed.filter(row => String(row.sourceWorkId || '').startsWith('unresolved-')).length
      },
      brokenDensity,
      fullResidualRate,
      machineGate,
      manualReview: {
        required: true,
        approved: manualApproved,
        seed: 20260825,
        residualRate: publishableResidualRate,
        rawResidualRate: residualRate,
        excludedCount: excludedIds.size,
        threshold: 0.02,
        approval: manualAudit,
      samples: auditSource.map(row => ({
        id: row.id,
        sourceHash: row.sourceHash,
        sourceWorkId: row.sourceWorkId || '',
        canonicalWorkId: row.canonicalWorkId || logicalWorkId(row, ''),
        sourceNovelId: row.sourceNovelId || '',
        corpus: row.corpus,
        archetype: row.archetype,
        dimension: row.dimension,
        text: row.text,
        forbiddenTerms: row.forbiddenTerms,
        residualTerms: row.residualTerms || [],
         provenance: row.provenance || null,
         occurrences: candidateOccurrences(row),
         classification: row.classification || null
      }))
      }
    }
  };
}

/** Write the versioned index and its audit report without publishing unapproved strong samples. */
function writeBuild(options) {
  const markdown = fs.readFileSync(options.input, 'utf8');
  const sourceList = readOptionalJson(options.sources || DEFAULT_SOURCES, { sources: [] });
  const archiveManifest = readOptionalJson(options.archiveManifest || DEFAULT_ARCHIVE_MANIFEST, null);
  const quotaConfig = prepareBuildQuotaConfig(loadQuotaConfig(options), true);
  const blocklist = readOptionalJson(DEFAULT_BLOCKLIST, { groups: [], minDistinctNames: 2 });
  const sourceLookup = buildUnifiedSourceLookup(sourceList);
  const parsedRows = parseSourceMarkdown(markdown).map(row => enrichCorpusRow(row, sourceLookup));
  const candidateResult = buildArchiveCandidateRows({
    archiveManifest,
    sourceList,
    config: quotaConfig,
    blocklist,
    extractArchiveCandidates: options.extractArchiveCandidates !== false,
    intermediate: options.intermediate,
    force: options.force === true
  });
  const classificationReview = applyClassificationReviews(candidateResult.rows, options.classificationReview || '', quotaConfig);
  candidateResult.rows = confirmCatchphraseRows(classificationReview.rows, quotaConfig);
  candidateResult.classificationMode = classificationReview.file
    ? 'lexical-candidate-model-review-applied'
    : candidateResult.classificationMode;
  const approvedCandidateRows = candidateResult.rows.filter(row => isApprovedArchiveCandidate(row, quotaConfig));
  const combinedRows = [...parsedRows, ...approvedCandidateRows];
  const markdownHash = crypto.createHash('sha256').update(markdown).digest('hex');
  const inputHash = buildContextHash({
    markdownSha256: markdownHash,
    candidateRowsSha256: sourceRowsHash(candidateResult.rows),
    sourceListSha256: buildContextHash(sourceList),
    manifestSha256: buildContextHash(archiveManifest),
    configSha256: buildContextHash(quotaConfig),
    pipelineRevision: PIPELINE_REVISION
  });
  const incremental = buildIncrementalCorpus(combinedRows, options, inputHash, {
    sourceList,
    archiveManifest,
    config: quotaConfig
  });
  const candidateKeys = new Set(approvedCandidateRows.map(row => `${corpusSampleKey(row, row.text)}|${row.dimension || ''}`));
  const incrementalCandidateRows = incremental.rows.filter(row => candidateKeys.has(`${corpusSampleKey(row, row.text)}|${row.dimension || ''}`));
  const incrementalParsedRows = incremental.rows.filter(row => !candidateKeys.has(`${corpusSampleKey(row, row.text)}|${row.dimension || ''}`));
  const result = buildIndex(markdown, {
    ...options,
    sourceList,
    sourceLookup,
    archiveManifest,
    quotaConfigValue: quotaConfig,
    parsedRows: incrementalParsedRows,
    archiveCandidateRows: incrementalCandidateRows,
    classificationCandidateRows: candidateResult.rows,
    archiveCandidateClassificationMode: candidateResult.classificationMode,
    classificationReviewResult: classificationReview,
    buildInputHash: inputHash
  });
  result.report.incremental = {
    intermediateRoot: options.intermediate ? path.relative(RESOURCE_ROOT, options.intermediate).replace(/\\/g, '/') : '',
    progressPath: incremental.progressPath ? path.relative(RESOURCE_ROOT, incremental.progressPath).replace(/\\/g, '/') : '',
    legacyParsedWorks: new Set(parsedRows.map(row => logicalWorkId(row, row.sourceUrl))).size,
    candidateArchiveWorks: new Set(approvedCandidateRows.map(row => logicalWorkId(row, row.sourceUrl))).size,
    combinedLogicalWorks: incremental.rows.length ? new Set(incremental.rows.map(row => logicalWorkId(row, row.sourceUrl))).size : 0,
    processedBooks: incremental.processedBooks,
    skippedBooks: incremental.skippedBooks,
    resumed: incremental.skippedBooks > 0,
    inputHash,
    configHash: buildContextHash(quotaConfig),
    manifestHash: buildContextHash(archiveManifest),
    sourceListHash: buildContextHash(sourceList),
    pipelineRevision: PIPELINE_REVISION,
    candidateRows: candidateResult.rows.length,
    candidateWorks: new Set(candidateResult.rows.map(row => row.sourceWorkId)).size,
    candidateClassificationMode: candidateResult.classificationMode,
    classificationReview,
    candidateSkipped: candidateResult.skipped
  };
  result.index.audit.incremental = result.report.incremental;
  fs.mkdirSync(options.output, { recursive: true });
  fs.writeFileSync(path.join(options.output, 'index.json'), JSON.stringify(result.index, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(options.output, 'quality-report.json'), JSON.stringify(result.report, null, 2) + '\n', 'utf8');
  if (options.markdownOutput) {
    fs.mkdirSync(path.dirname(options.markdownOutput), { recursive: true });
    fs.writeFileSync(options.markdownOutput, renderPublicReleaseMarkdown(result.index, result.report), 'utf8');
  }
  return result.report;
}

// 供单元测试导入的内部函数（不直接运行构建时这些导出不影响 CLI）
export {
  anonymizeSample,
  candidateNameTerms,
  fixQuoteBoundary,
  isQaSample,
  isBrokenAnonymization,
  scanCorpusNameCombos,
  loadCharacterLibraryNames,
  parseSourceMarkdown,
  buildArchiveCandidateRows,
  buildCanonicalDedupAudit,
  verifyCandidateProvenance,
  applyClassificationReviews,
  confirmCatchphraseRows,
  validateQuotaConfig,
  loadQuotaConfig,
  buildIncrementalCorpus,
  calculateProfile,
  buildProfiles,
  buildQuotaReport,
  extractCharacterEvidence,
  validModelEntityEvidenceSpans,
  stableCharacterKey,
  evaluateRawGenreProfiles,
  evaluateProfileRelease,
  evaluateMarkdownPublication,
  calculateRawGenrePublicationCoverage,
  scoreWorkForSelection,
  selectPublicationRows,
  selectPerBookCellCap,
  calculatePlatformCoverage,
  renderPublishedMarkdown,
  renderPublicReleaseMarkdown,
  buildIndex,
  WHITELIST
};

// 仅当作为命令行主模块直接运行时才执行构建（便于单元测试 import 内部函数而不触发写盘）
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const options = readOptions(process.argv.slice(2));
  const characterLibraryNames = await loadCharacterLibraryNames();
  const report = writeBuild({ ...options, characterLibraryNames });
  console.log(JSON.stringify({ version: report.version, counts: report.counts, manualReview: report.manualReview }, null, 2));
}
