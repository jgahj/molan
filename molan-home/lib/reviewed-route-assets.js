'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { BOOKS, VERSION, parseBook, validateReview } = require('./xuanhuan-reading');

function buildReviewedRouteAssets(job, { routeId, owner, sourceBuffer }) {
  const specification = BOOKS.find(book => book.id === routeId);
  const empty = status => ({ status, routeId, sourceTitle: specification?.title || '', lessons: [] });
  if (!specification) return empty('not_applicable');
  if (!owner || !job || job.owner !== owner || job.status !== 'completed' || job.activated !== true) return empty('not_activated');
  if (job.version !== VERSION) return empty('protocol_mismatch');
  const book = job.books?.find(item => item.id === routeId && item.filename === specification.filename);
  if (!book || !book.chapters?.length) return empty('source_missing');
  if (crypto.createHash('sha256').update(sourceBuffer).digest('hex') !== book.hash) return empty('source_changed');
  try {
    const fresh = parseBook(sourceBuffer, specification, book.chapters.length);
    const lessons = [];
    for (const chapter of fresh.chapters) {
      const synthesis = job.stages?.[`${chapter.id}:synthesis`];
      const review = structuredClone(job.stages?.[`${chapter.id}:review`]);
      if (!synthesis || !review) return empty('review_incomplete');
      validateReview(review, synthesis, chapter.paragraphs);
      const candidates = review.notes.claims.filter(claim =>
        claim.kind !== 'open_question' && review.checks.some(check => check.claimId === claim.id && check.verdict !== 'uncertain'));
      candidates.sort((first, second) => Number(second.kind === 'inference') - Number(first.kind === 'inference'));
      lessons.push(...candidates.slice(0, 2).map(claim => ({
        chapterId: chapter.id, chapterTitle: chapter.title, claimId: claim.id, kind: claim.kind,
        topic: claim.topic, application: claim.application, limits: claim.limits,
        reviewVerdict: review.checks.find(check => check.claimId === claim.id).verdict,
        evidence: claim.evidence
      })));
    }
    if (!lessons.length) return empty('no_supported_lessons');
    return { status: 'ready', routeId, sourceTitle: specification.title, sourceHash: book.hash,
      jobId: job.id, protocol: job.version, reviewedChapters: fresh.chapters.map(chapter => chapter.id), lessons };
  } catch (_) {
    return empty('invalid_review');
  }
}

const BUILTIN_ROUTE_LESSONS = {
  yuanshi: {
    sourceTitle: '元始法则',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '工业现实与尺度递进', application: '以重型工业/科考巨舰的空间规格（吃水、水密门、甲板绞盘）托起超凡异常，在数千米外借光学与声呐捕捉数据突变，层层推进危机。', limits: '适用于宏大探索与重型器械背景，不适用于幽闭密室。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '克制心智与资格延后兑现', application: '主角背负隐痛但情绪极其内敛，面对关系户轻视不当场打脸争辩，用专业素养默默记录关键数据，在生死断后中用硬核技能完成救赎。', limits: '主角需具备成熟专业能力，不可无缘无故隐忍。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '航海工规口吻与防务细账自嘲', application: '融入水密舱气压、潜航配重与探照能耗的实务黑话，人物在极端异象下保持对补给、设备折旧的琐碎算计与老水手式的干瘪冷幽默，绝不大惊小怪。', limits: '需符合远洋巨舰科考纪律与重型器械背景。' }
    ]
  },
  jianzhu: {
    sourceTitle: '剑烛大荒',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '对白次文本与人情博弈', application: '对白带有试探、掩饰与善意谎言，双方说出口的台词与内心诉求错开，每次交谈实质性推动信任度与行动策略的位移。', limits: '对话双方需有各自信息差，不用于单向信息播报。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '市井烟火与器物磨损互嵌', application: '超凡道具与机关融入柴米油盐（木鸢颠簸漏风要花钱修、巡防与租金琐事），人物在离奇处境下保持自省与冷幽默自嘲。', limits: '需保持生活温度，不可写成纯冷血搏杀。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '晋楚方言土白与底层穷酸解构', application: '对白穿插生动地道的市井俗语（“日头晒屁股”、“扯淡”、“半角碎银换个破皮袄”），在大荒异象压迫下以小人物的柴米油盐和嘴硬自嘲化解假大空悲壮。', limits: '保持世俗温情与市井烟火气，不可滥用现代网络梗。' }
    ]
  },
  xuanjian: {
    sourceTitle: '玄鉴仙族',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '宗族谱系与生产命脉', application: '以家族族谱、灵田亩产、供奉岁贡与宗祠序齿切入，修仙建立在扎实的经济与代际牺牲上，个人命运紧锁族运更迭。', limits: '适用于家族群像与修真基建，不适用于无牵无挂的独行侠。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '苍凉克制的代际传承', application: '老辈修士灵脉枯竭暗伤难愈，将丹药法器留给后辈；面对至亲牺牲保持肃穆静默，将悲愤化为刻骨铭心的族运布局。', limits: '需展现几代人的时间跨度与沉重历史感。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '宗族土白与微观生存细账', application: '对白采用地道南方乡土口吻（阿爹、瓜娃子、给后生留口饭），账目精确到几石几斗几两蜂蜡，穿插屋顶漏光等家常闲笔。', limits: '需保持乡土厚重与泥土质感，拒绝书面普通话。' }
    ]
  },
  fanren: {
    sourceTitle: '凡人修仙传',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '资质劣势与生计精算', application: '主角资质平庸，每走一步都要精算灵石花销、丹药抗药性与法器磨损，在修仙黑市与坊市中靠严谨辨药知识立足。', limits: '适用于底层挣扎与资源匮乏情境。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '藏拙自保与绝对防备', application: '恪守财不露白原则，遇险先观察退路；动手必下死手且毁尸灭迹，师徒同门皆需以心魔毒誓与利益制衡维系。', limits: '主角需有足够耐心与定力，绝不可强出风头。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '冀南土话方言与草根抠搜生计', application: '对白融入北方乡野老农式的谨小慎微土白（“瞎咧咧”、“中不中”、“攒半拉干粮”），精算到半两灵砂与破烂符纸的折损，遇险时对修仙大能的崇高光环报以冷眼算计。', limits: '主角需恪守底层小农生存逻辑，坚决摒弃狂妄装逼。' }
    ]
  },
  urban_grind: {
    sourceTitle: '以神通之名',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '现代法理与武道行规咬合', application: '超凡武道必须接受特勤执照、防卫过当判定与城市治安监控网规制，人物在规矩程序内周旋取证。', limits: '背景为现代秩序都市，不可无视法律胡乱杀戮。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '沉重刚硬的物理受力攻防', application: '格斗强调重心控制、发力支点、合金防暴板凹陷破裂与肌肉过载拉伤，严禁游戏跳字打卡。', limits: '搏杀需考虑现代建筑空间与周边监控死角。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '体制公职切口与社畜冷面反讽', application: '熟稔使用勘验令、编外派遣、违规扣押等体制行话，穿插对失眠服药、加班报销的自嘲碎碎念，让超凡融入冰冷规则。', limits: '人物具有成熟公职素养，严禁底层小混混嘴炮。' }
    ]
  },
  yucun_1982: {
    sourceTitle: '重回1982小渔村',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '沿海捕捞器械与潮汐生活考据', application: '精准描写拖网绞盘机油味、柴油单缸机震颤、潮位水线与渔港码头过磅，用极具颗粒度的咸湿生活流打破虚浮感。', limits: '适用于海滨乡土与年代生产致富。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '严谨经济账与宗族情义', application: '每一次出海的柴油开销、冰块成本、海鲜分拣成色算计得一清二楚，展现渔民生死相托的淳朴情义。', limits: '不可搞脱离时代的夸张超自然开挂。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '闽南沿海阿公白话与咸腥互损', application: '穿插“讨海人”、“丢海里喂鱼”、“一网虾皮能换两包大前门”等闽南渔民土白与粗粝打趣，柴油机喷黑烟与补网结痂的痛痒中展现海民乐天顽强。', limits: '必须贴合80年代沿海生产生活真实，不得虚构现代高科技捕鱼。' }
    ]
  },
  daguo_junken: {
    sourceTitle: '大国军垦',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '重工业垦荒与水利实感', application: '描写履带式拖拉机卡泥抢修、水利修渠引水测绘、防风林盐碱化固沙，展现战胜严酷自然的硬核工业劳作。', limits: '强调集体英雄主义与历史真实奉献。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '铁骨纪律与时代物态', application: '工分账本、掉漆搪瓷缸、红油马灯，在黄沙扑面与开荒塌方中展现军垦人百折不挠的坚韧风骨。', limits: '语言需质朴深沉，杜绝轻浮作风。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '西北大白话与风沙粗粝自嘲', application: '对白带浓重西北戈壁腔（“龟儿子”、“瓜皮”、“老子这身烂皮肉顶得上二两生铁”），在开荒抢险、风吹石头跑的苦寒中用粗犷打趣消解崇高，充满革命乐观主义。', limits: '语言质朴坚韧，紧贴兵团建设史实。' }
    ]
  },
  hard_survival: {
    sourceTitle: '这游戏也太真实了',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '废土资源铁律与负荷约束', application: '辐射读数、滤网饱和度、外骨骼电池衰减作为持续施压的客观枷锁，一切战术行动必须计算消耗成本。', limits: '环境需具有严酷辐射或极端气候压迫。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '土造军工与机械装配质感', application: '描写废旧零件拼装、枪机拉柄卡死、手搓黑火药膛压不稳等硬核枪械细节，人物动作冷峻克制。', limits: '战斗需体现武器磨损与掩体破坏。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '避难所粗口俚语与废土抠门日常', application: '穿插老避难所行话与废土流民黑话（“捡破烂”、“老鼠肉干”、“扣电池皮”），以饥饿、拉肚子、防毒面具漏气的狼狈自嘲对抗末日崇高假象。', limits: '严格基于硬核生存代谢律，杜绝无脑降智开挂。' }
    ]
  },
  dawn_blade: {
    sourceTitle: '黎明之剑',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '魔导工业化领地基建', application: '把超凡魔法转化为可量产、可铺设导轨的实用工业技术，详述排污、水泥煅烧与工厂流水线打破贵族垄断。', limits: '适用于文明开拓与工业变革叙事。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '深空去魅与神性反思', application: '以卫星阵列轨道监控、信仰污染过滤与文明周期律的理性思维审视不可名状神明，驱散蒙昧。', limits: '宏大反思需与领地柴米油盐温情交织。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '老祖宗棺材板自嘲与领地财税吐槽', application: '主角在神性庄严中保持“揭棺而起”的现代老祖宗幽默与科学理性，对话充满领地工分、水泥标号、下水道堵塞的行政碎碎念，反衬史诗宏阔。', limits: '幽默需建立在严谨的文明拓荒与理性推演上。' }
    ]
  },
  swallow_star: {
    sourceTitle: '吞噬星空',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '基因武者体制与参数记录', application: '描写准武者拳力速度测试、作战服合金受力、荒野实战记录仪与怪兽解剖核心材料收购评级。', limits: '适用于未来高武与废墟狩猎。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '荒野废墟战术协同与宏大尺度', application: '高架桥隐蔽狙击、战刀刃口磨损、基地市万米合金防御墙与深空巨兽俯冲的宏伟压迫感。', limits: '需保持动作戏的物理撞击与环境破坏反馈。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '江南基地市草根俚语与猎人脏话', application: '融入江南旧区里弄白话与荒野猎人黑话（“扑街”、“拼命换一管营养液”、“怪兽皮毛压秤”），在高压生死厮杀间隙以修理战甲和数钞票的市井气维持理智。', limits: '展现平民武者阶层跃迁的艰辛，不搞浮夸装逼。' }
    ]
  },
  laoshiren: {
    sourceTitle: '捞尸人',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '黄河捞尸行规与民俗禁忌', application: '水上漂尸三不捞、扎排捞尸麻绳系腰、水鬼铜钱压口，行话扎实，严守民间古老行当守护规则。', limits: '适用于江河民俗与压抑灵异氛围。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '水流死相微观勘验与因果偿还', application: '从回水湾泥沙淤积、尸身水浸水线、指甲沙砾推导死者生前冤屈，恐怖背后尽是人间冷暖。', limits: '拒绝廉价跳脸惊吓，重在宿命感。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '陕甘黄河滩方言与老水鬼粗鄙诨话', application: '对白满是黄河滩客粗粝土语（“狗日的水鬼”、“老汉骨头轻”、“三碗烈酒暖肚子”），在阴森水腥与死人晦气中用满嘴跑火车的浑话驱散恐惧，接地气而透彻。', limits: '恐怖氛围与民俗禁忌需严肃庄重，荤话浑话只作避险压惊。' }
    ]
  },
  rule_horror: {
    sourceTitle: '玩家请上车',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '规则漏洞推理与空间戒律', application: '围绕血字安全守则、列车广播变调与站台停靠倒计时展开生死推导，在自相矛盾的戒律中寻找生机。', limits: '适用于规则怪谈与封闭空间博弈。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '心理防线极限压榨', application: '有限光源、不可信的同行者、手表齿轮卡壳与逐渐逼近的未知存在，制造深邃窒息的心理恐惧。', limits: '主角必须保持绝对理智冷酷。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '黑色冷幽默与死亡机制漏洞调侃', application: '主角在绝命列车与诡异禁忌中保持极其冷静的毒舌与反逻辑自嘲（“这鬼乘务员没给发票”、“按规则它不能碰我的衣角”），用荒诞逻辑撕破恐惧假象。', limits: '幽默必须建立在精准抓取规则漏洞的极度智商之上。' }
    ]
  },
  dynasty_friction: {
    sourceTitle: '神话版三国',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '万人大阵与超凡军制实战', application: '超凡武勇融入军团严密建制，详述旗语指挥、云气压制、粮道常平仓转运与万人步骑受力重心。', limits: '适用于大型古代战役与天下争霸。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '大国财政治理与豪杰心气', application: '钱粮折色、盐铁转运、堤坝修筑等大国理政谋略，谋士名将言辞机锋左右天下格局。', limits: '人物需有古代名士风骨，杜绝现代小白做派。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '汉末北方官话与名士懒散吐槽', application: '军师大将私下交谈充满“懒癌发作”、“算得脑仁疼”、“屯田粮仓又被老鼠咬了”等生活化吐槽，与战场上天地变色的军团铁血形成鲜活反差。', limits: '保持汉魏风骨与治国胸襟，不可流于现代轻浮网梗。' }
    ]
  },
  spy_years: {
    sourceTitle: '我的谍战岁月',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '短波无线电与硬核谍报技术', application: '严谨描写电子管发热、石蜡纸复写密信、暗号错位核验与绝密档案火漆拆封，细节滴水不漏。', limits: '适用于隐蔽战线与敌后潜伏。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '窒息敌我心理攻防与牺牲觉悟', application: '每一句看似客套的寒暄都暗藏杀机，口供推演滴水不漏，领口下藏着氰化物胶囊随时赴死。', limits: '主角需极度冷静隐忍，绝不意气用事。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '海派市井俚语与冷面幽默', application: '融入生煎馒头、公用电话亭、电车票价、三五牌香烟等上海租界细节，以市井老油条姿态掩护严酷谍战，对话暗藏机锋。', limits: '主角需机警幽默、游刃有余，拒绝死板特工模板。' }
    ]
  },
  folklore_investigation: {
    sourceTitle: '民俗惊悚异闻',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '宗族禁忌与乡野旧案考据', application: '以地方志异、宗祠旧契、荒冢祭祀仪轨为证据链，将超自然恐怖嵌套于乡村熟人社会的宗族伦理中。', limits: '需保持中式民俗的沉郁阴冷质感，杜绝欧美血浆式生硬惊吓。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '感官侵蚀与心理防线坍塌', application: '借由气味（发霉寿衣、香烛冷灰）、温度骤降与视觉边缘的模糊异象，层层加压推高窒息心理恐惧。', limits: '恐怖递进必须合乎逻辑，留白大于直接展现怪异实体。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '湘西黔北乡傩黑话与草民自嘲避煞', application: '融入“走山客”、“撞客”、“讨碗符水暖胃”等乡野土白与打牙祭玩笑，在阴冷山林破庙中以老农老猎户的油滑与求生本能对抗阴邪。', limits: '民俗禁忌考据严密，不得写成滑稽闹剧。' }
    ]
  },
  sequence_cost: {
    sourceTitle: '诡秘序列',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '魔药消化与不可逆疯狂代价', application: '超凡力量每一分增长都伴随理智侵蚀，严格以“扮演法”对抗失控，时刻警惕不可名状的低语。', limits: '超凡能力必须具备明确副作用与限制。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '维多利亚蒸汽工业质感', application: '煤气灯光晕、双轮马车辚辚、工人罢工游行与报童呼号，将非凡事件扎根于充满煤灰的雾都日常。', limits: '语言需优雅克制，充满古典推理感。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '鲁恩王国绅士冷幽默与贫穷自嘲', application: '融入金镑、苏勒、便士的微观物价精算（“这杯劣质红茶值半个便士”），以克制的英式黑色幽默与扮演法心得自嘲，在疯狂阴影下维持理性尊严。', limits: '语言克制优雅，具有古典翻译小说腔调与严肃推演。' }
    ]
  },
  super_mechanic: {
    sourceTitle: '超神机械师',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '硬核机械锻造与装配公差', application: '车床打磨公差0.01毫米、线路焊接、磁轨炮充能过热与机甲钢淬火，展现沉重工业美学。', limits: '适用于机械科幻与阵营战争。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '星际阵营撬动与军团火力', application: '凭借技术垄断在财阀与军火商间游刃有余，展现智械蜂群与重炮阵列对轰的震撼场面。', limits: '需保持严密的技术逻辑与成本演算。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '萌芽黑话与NPC老油条割韭菜自嘲', application: '融入雇佣兵切口、二手零件黑市黑话与“韭菜长势喜人”、“修理费翻倍”的资本家式冷幽默，在硬核装甲与星际争霸中维持从容不迫的市井老辣。', limits: '主角需运筹帷幄、技术碾压，幽默服务于利益收割。' }
    ]
  },
  reincarnation_paradise: {
    sourceTitle: '轮回乐园',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '纯粹利益与冷酷猎杀契约', application: '主角目标极度纯粹直接，为完成契约不择手段，绝无圣母犹豫与道德说教。', limits: '适用于高烈度生死博杀与无限试炼。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '刀刀见肉的宗师级近身搏杀', application: '动作描写强调发力重心、神经反射、兵刃切削骨骼受力阻滞与装备耐久折损，极度凶险。', limits: '动作戏杜绝华而不实的空洞光效。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '契约黑市黑话与猎杀者极简干瘪冷幽默', application: '乐园公证、乐园币兑换、属性点精算与斩龙闪开锋磨损，对话极度简洁凌厉，对所谓正义嘴炮报以“多带两颗手雷”的死寂反讽。', limits: '杀伐果断、绝不废话，冷幽默需短促尖锐。' }
    ]
  },
  mansion_secrets: {
    sourceTitle: '深宅利益世情',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '月例账目与深宅内耗利益链', application: '对牌领银、月例缎匹克扣、老太太请安座次排序与丫鬟耳目，展现平静水面下的刀光剑影。', limits: '适用于宅门世情与阶层争斗。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '滴水不漏的闺阁人情机锋', application: '举手投足遵从世家礼数，言语温婉周到却暗藏借刀杀人算计，重视身不由己的命运悲欢。', limits: '不可使用现代网络流行语与粗鲁粗口。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '京畿世家雅谑与微观私房账自嘲', application: '运用“老太太跟前的体面”、“二钱燕窝碎末”、“当铺死当”等内宅隐语，在锦绣堆里算计柴米油盐，谈笑间用软刀子割肉，透出封建牢笼中人的自怜与机敏。', limits: '语言古朴温润、含蓄克制，绝不可粗俗直白。' }
    ]
  },
  urban_emotion: {
    sourceTitle: '职场博弈心动',
    lessons: [
      { chapterId: 'c1', claimId: 'claim-1', topic: '投行对赌与专业生存壁垒', application: '尽调底稿瑕疵、竞业限制协议、期权违约惩罚条款，感情建立在共同扛过行业风暴的坚韧上。', limits: '适用于现代职场与势均力敌的情感。' },
      { chapterId: 'c2', claimId: 'claim-2', topic: '真实都市感官与细腻心动', application: '凌晨三点便利店热腾腾的关东煮、暴雨里排队99+的打车软件，成年人的心动发生在暴露脆弱底色的瞬间。', limits: '拒绝工业糖精与无脑打脸宠溺。' },
      { chapterId: 'c3', claimId: 'claim-3', topic: '陆家嘴金融黑话与高压社畜自嘲互损', application: '穿插“对赌兜底”、“过桥资金”、“合规风控红线”等行业术语，在暴雨赶末班车、胃痛吞止痛药的疲惫中以干瘪毒舌互损拉近距离，真情在破防时刻自然流露。', limits: '职场专业性不可动摇，情感发展需克制有迹可循。' }
    ]
  }
};

function loadReviewedRouteAssets({ routeId, owner, dataDirectory, sourceDirectory }) {
  const specification = BOOKS.find(book => book.id === routeId);
  const empty = status => ({ status, routeId, sourceTitle: specification?.title || '', lessons: [] });
  if (!specification) return empty('not_applicable');

  const filename = dataDirectory ? path.join(dataDirectory, 'xuanhuan-lab', 'reading.db') : '';
  if (owner && filename && fs.existsSync(filename)) {
    let database;
    try {
      const { DatabaseSync } = require('node:sqlite');
      database = new DatabaseSync(filename, { readOnly: true });
      const rows = database.prepare('SELECT payload FROM reading_jobs WHERE owner=? ORDER BY updated DESC LIMIT 40').all(owner);
      const job = rows.map(row => JSON.parse(row.payload)).find(item => item.status === 'completed' && item.activated === true);
      if (!job) return empty('not_activated');
      const sourceBuffer = fs.readFileSync(path.join(sourceDirectory, specification.filename));
      return buildReviewedRouteAssets(job, { routeId, owner, sourceBuffer });
    } catch (_) {
      return empty('unavailable');
    } finally {
      database?.close();
    }
  }

  if (routeId && BUILTIN_ROUTE_LESSONS[routeId]) {
    const b = BUILTIN_ROUTE_LESSONS[routeId];
    return {
      status: 'unverified-builtin',
      routeId,
      sourceTitle: b.sourceTitle,
      sourceHash: null,
      jobId: null,
      protocol: 'unverified-notes',
      reviewedChapters: [],
      lessons: b.lessons
    };
  }

  return empty('not_activated');
}

function buildReviewedLessonsBlock(assets) {
  if (assets.status !== 'ready') return `【精读资产状态】${assets.status}。未注入复核笔记，不得声称已应用精读成果。`;
  return `【已复核精读方法：仅供选择，不是逐条完成的写作任务】
来源《${assets.sourceTitle}》，范围仅${assets.reviewedChapters.length}章；不是全文水平认证。
按本章人物和情境选用适用方法，保留不适用的方法为空，不硬造误判、代价、冷幽默或反转。
${assets.lessons.map(lesson => `[${lesson.chapterId}/${lesson.claimId}] ${lesson.topic}
方法：${lesson.application}
适用边界：${lesson.limits}`).join('\n\n')}`;
}

module.exports = { buildReviewedRouteAssets, loadReviewedRouteAssets, buildReviewedLessonsBlock };
