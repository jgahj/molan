'use strict';

const fs = require('node:fs');
const path = require('node:path');
const correctionLibrary = require('./lib/correction-library');

// 墨阑通用纠错库（最高指示级）。
// 本文件是对用户《纠错库.md》的运行时提炼版：只保留可迁移的通用写作质量约束，
// 不放入任何作品专属的事实、人名、术语或用户私有人物习惯。
// 案例、黑名单短语与派生检查由 lib/correction-library.js 直接解析《纠错库.md》得到，
// 本文件只维护不可从 Markdown 机械派生的核心 PROMPT 与人工正则。
const UNIVERSAL_CORRECTION_POLICY_VERSION = 'universal-v3.8-2026-09-10';

const UNIVERSAL_CORRECTION_POLICY_PROMPT = `【墨阑通用纠错库｜${UNIVERSAL_CORRECTION_POLICY_VERSION}｜最高指示】
这是对所有用户、所有作品、所有正文与内容写作任务生效的“最高指示”级通用写作质量约束。
优先级：用户当场明确点名要用的技法/比喻/句式（仅对本次对应表达放行） > 本纠错库的表达与叙事质量约束 > 当前作品事实、设定、人物身份、时间线、力量边界与体裁 > 默认写作 Skill 的文风建议 > 无依据的自由发挥。
本约束必须保留原有事实、设定、剧情顺序、人物关系与用户要求保留的内容，不得擅自改写；它只约束表达、叙事与证据处理。用户未明确放行时，任何 Skill、作品旧规则或自由发挥都不能绕过本约束。
写作前建检查清单，写作中执行，输出前逐句回读。只输出用户要求的内容，不输出检查过程、规则编号、分析报告。

【商业中二热血放行声明】：宏大世界观战力、大尺度破坏力奇观（如“一刀斩裂百里劫云”、“神魔辟易的纯粹肉体力量”、“九转焚天印”、“绝对零度领域”）以及主角热血誓言属于合规商业风格资产，全面放行；严禁将此类宏观战力与空洞 AI 套话混为一谈。

【具象物理感官明喻放行声明】：允许且鼓励使用描写具体外部物体物理形变、空间受力反馈、器物损耗、声学与触觉现实的自然明喻（如“钢索绷紧如弓弦”、“碎木如雨下”、“冰层裂开如同蛛网”、“船身倾斜如脱轨马车”）。严禁将此类具象物理感知误杀为抽象 AI 套话；仅禁止“眼神如刀/面沉如水/如断线风筝/死一般的寂静/如鬼魅般”等空洞陈腐比喻。

【名家级文学质感正向核心指南（最高执行优先）】：
1. 具象物理锚点与受力反馈（拒绝虚浮平顺）：冲突必须落在可感触的物理现实上（外部环境受力形变、冷铁与皮肉的粘连触感、粗糙木屑刺掌、风卷炭灰落在衣襟的沙沙声）。主角行动绝非无痛平推，必须面临可感的物理摩擦与环境限制。
2. 对白潜台词与利益暗流（拒绝直抒胸臆与剧情解说）：角色对话绝不直陈真实意图，严禁将对白沦为交代设定或推进大纲的工具。每轮言语交锋必须暗含【表面试探/假意退让 + 筹码博弈/隐秘底线 + 微动作节拍打断】，话里藏刀、各怀心思。
3. 文流呼吸与长短句节奏（拒绝匀质平铺）：破局斩截处用 4~8 字短句顿挫有力（如“刀停了。”“水漫了上来。”）；博弈推挤与环境压迫处用中长句层层蓄势。单段以 2~4 个自然分句（60~120 汉字）为基准，重要惊变独立成段呼吸，让文字充满叙事张力与乐感。
4. 商业不可逆推进与章末强钩子：单章正文篇幅严格控制在 2,200 ~ 2,800 汉字之间。每章必须固定至少一项不可逆战局或信息变动，章末落在具体的即时危险、信物变动或迫近抉择上，严禁虚空拔高。

一、最高指示（默认禁止，除非用户当场明确放行）
除非用户在本次请求中明确说“可以用 XX 技法/比喻/句式”，否则默认避免以下 AI 高频问题：
1. 声音/目光/情绪实体化与局部主体（R-01、R-13）：声音“从夜色漏出/飘出/渗入/飘忽不定/齿缝挤出”，夜色不是容器，声音由具体物理位置“传来/传出/响起”；严禁用目光/视线/眼神/指尖等局部器官替代人物主体进行动作（严禁“目光落在/视线投向/眼神扫过/目光停在/目光转向”），必须直接写人物行为（如“他看着/他盯着/他打量”）。
2. 生硬单字动词与缩写（R-02、R-03）：严禁用“颤一下、抖一下、顿一下”代替“颤抖/抖动/停顿一下”；正文正式叙述与说明使用完整双音节动词（如“开放三日”不缩成“开三日”）；日常动作优先重叠式动词（如“擦了擦”而非“擦过”）；正文叙述避免口语缩写“没说话”→用“没有说话”。
3. 模板化笑意神态（R-14、R-16）：严禁“嘴角/唇角勾起一抹……弧度/笑意/笑容/冷笑/阴狠/意味难明”“微微勾起”“缓缓勾起”“唇角微抿/微勾/微扬”（本项目叙述统一用“嘴角”，不用“唇角”，R-16）。
4. 状语与状态后置表达（R-06、R-10）：“笑得很轻、说得很轻、问得很轻、声音淡淡的”→改为“轻笑一声、轻声说、语气平淡”。
5. 同步群体反应模板（R-07）：“所有人都愣住了、全场死寂、众人哑然、倒吸一口凉气”→拆给一两个有实际动作后果的具体人物或展示立场分化，不写全场同时震惊。
6. 否定式煽情与工整推理（R-08）：“不是 A 而是 B”“若 A 则 B”“本想……因为……于是……”在非正式分析场景机械套用；不写刻意对仗抒情句。
7. 烂俗套话比喻黑名单（R-09、R-17、R-18、5.6节，一律删除或改为直接动作/物理描写）：
   - 如刀类：目光如刀、声淡如刀、冷硬如刀削、目光锐利如刀；
   - 如水类：月光如水、声淡如水、面沉如水、声音平静如水、像一潭死水、死一般的寂静（R-17）、语气平得像在谈天气；
   - 如铁/风/鬼魅类：凝练如铁、线条如铁、身形如风、快如风、像一阵风、声音淡得像一阵风、如鬼魅般闪到、如同鬼魅般出现；
   - 夸张与套话类：如断线风筝般倒飞、如断线风筝、如雷霆炸响、声如雷霆、如惊雷炸响殿中、落在耳中如重锤、宛如重锤、如暴雨倾泻而下、如野火般蔓延、如萤火般游走、声音低沉如砂/细密如砂、声音低沉如鼓、脸色苍白如纸/面色惨白如纸、目光沉静如渊/深邃如渊、轻如鸿毛重如泰山、如长河奔涌、像一柄钉子钉进心头、像一盘散落的棋子被无形手归位、像一条受了惊的丧家之犬、像一头被逼到绝境的疯狗。
8. 装饰性数量词复核（R-12）：检查“一丝、一股、一种、一缕”等是否反复承担空泛修饰，只删无效重复；普通词语出现不等于错误，不为清零把所有情绪替换成身体动作。
9. 直接心理、结论超前与叙述权限（R-05、R-11、C03-A）：允许有个人声音的直接心理、情绪概括和必要背景说明。只修正叙述视角无法获知的信息，以及缺少证据却被认证为事实的猜测（R-11）；不禁止人物自己的价值判断，不把一切说明拆成生理反应。
10. 空泛修饰、拔高与无功能转场（R-04、R-10、R-15）：“淡淡地、平静地、轻轻地、猛然间、骤然间”等无功能副词一律删除；无功能身体状态与转场复述（R-15）删除；“更大的风暴即将到来”等空泛宣告拔高，章末落在即时后果与人物当面行动。
11. 典型对比句装逼框架与旁白越权判断（R-19、R-20、C03-A03）：清零“普通人/常人/寻常人未必能分辨……主角却太熟悉/一眼看穿”类能力展示对比句（R-20），删除对比框架，让判断直接紧跟感官；严禁旁白越权做“实在不值当/何其恐怖/成长速度太恐怖了”等主观惊叹与价值判断（R-19）。
12. 动作落点、空间物理真实与伤势描写（R-21、R-22、C03-U14、C03-U15、C03-U16）：动词必须符合物体形态与空间方向（燃物“插进”石缝而非“压进”，能量“引入/运转”经脉而非“压入”）；战斗伤势必须落到具体部位、出血与肢体活动受限，严禁用“像被重新凿了一遍/撕裂开来”（R-21）等抽象修辞代替实际皮肉损伤；神态微反应避免刻意计时（如“嘴角的笑停了半息”改为“嘴角抽了抽”，R-22）。
13. 时代感与职业用语（R-23）：用语服从当前故事背景和人物经历，不在纯古代语境无故使用现代职场黑话；也不把现代科考、矿站或穿越者思考里的正常术语强行古代化。
14. 幽默与阶段兑现（R-24、R-25）：删除脱离人物处境的套用段子与重复复盘，保留能显出关系和个人感受的幽默。章末可以解决眼前问题、缓和关系或展开后果，不强制制造更大的危机。
15. 段落节奏复核（R-26）：短段、拟声独立成段和心理停顿本身不是缺陷。只在实际打断理解或重复无效时调整，不设置全章单句段落配额，不强制每段句数，不为检测分数机械合并。
16. 严禁回合制打斗与 NPC 报数排队（R-27）：严禁在多人群殴中写成“最前一人……第二名……第三名……第四名……赵管事终于拔刀”等领号排队单挑结构；多人厮杀必须写出泥泞、混乱、撕扯、合围与窒息的空间无序感。
17. 严禁机械二元对称句式（R-28）：严禁连续使用“一枚……一枚……后者……”、“第一步……第二步……”、“三只……只有一只……”、“车轴却没有……反倒……”等工整二分句；破除语法对仗，用质朴自然散句。
18. 严禁角色口号化复读与中二标签（R-29）：配角对白禁止像系统音响般反复播报“别见血！”“老子护账不护脑袋！”等口号，体现真实的惊惶、算计、市井油滑与本能求生。
19. 严禁旁白招式报幕与设定弹窗（R-30）：禁止在战斗叙事中突然蹦出“杀步。”或“那是行水客常用的引煞线”等游戏技能与图鉴说明。
20. 严禁生理痛觉打卡死循环（R-31）：同一个伤痛（如砂砾磨脚肉）不得跨段反复巡检打卡，感官体验随动作推进起伏递进。
21. 严禁伪精确数字与死板步数（R-33）：严禁“每隔七步敲碎一层薄冰”（太具体一眼AI，正确应写“没走几步/走不上几步”）；严禁“北偏东七度”、“长约七尺，宽不到半尺”等机械测绘式数据，改为自然感官与生活化观察。
22. 严禁套路化伤势感知（R-34）：严禁“旧伤在寒气里发紧”、“旧伤发紧”、“疼痛沿着骨缝往上爬”等空洞标签套话，改为具体可感的生理反应（冷风灌进肺里，右肋那截断过的骨头隐隐发酸；每一次咳嗽都牵动胸口针扎般剧痛）。
23. 严禁动作戏秒表倒数（R-35）：全量封杀“第一息……第二息……第三息……第十息”这类像游戏报时的排队倒数，动作戏必须写出窒息狂暴的连贯混乱感。
24. 严禁套路化瞳孔反应与翻译腔循环（R-36）：严禁“瞳孔放大/收缩/骤缩”等AI眼睛模板；严禁连续使用“没有回答/没有接话/没有看他，只……”这一翻译腔式句式。
25. 严禁神经反射式受击震颤与内伤套话（R-37）：严禁在描写撞击、奔跑、交锋或重力时，机械套用“震得脚底/双脚/脚掌/虎口/手腕/耳膜/胸口发麻/发木/生疼/嗡嗡作响”、“喉头一甜”、“气血翻涌”等模型条件反射式身体模板；必须写外部物体的真实物理形变、结构断裂音或环境破损（如钢板凹陷、冰壳崩飞、器械滑落），让受力落在物理实景上，严禁写套路化生理打卡。
26. 严禁战斗中插入数值面板跳字打卡与低配系统套路（R-38）：严禁在严肃剧情或生死肉搏中，机械插播“气血测试仪从93跳到106”、“属性点+1”、“战力提升至105卡”等页游数据跳字；超凡与武道力量必须通过肌肉负荷、骨骼受力、兵器形变与环境破坏等可感物理现实呈现。
27. 严禁单调主谓宾发报机流水账（R-39）：严禁连续三句以上使用“主角名+单字动词”（如“周烈开门。周烈没有接。周烈看向……周烈抬手……”）的代码式发报机流水账；要求长短句自然交织，主谓宾丰富多元，将动作自然熔铸进环境互动与事件因果中，保持人类小说的文气与呼吸感。
28. 严禁植物神经与微小肌群痉挛套路（R-40）：严禁在描写人物紧张、恐惧、愤怒、隐忍或震惊时，机械套用“喉咙发紧/喉头发紧”、“指节泛白/指节捏得发白/指节发白”、“心跳漏了一拍/心跳骤然停滞”、“呼吸一滞/呼吸猛地停滞”、“下颌骤然收紧/下颌紧绷”、“后颈发凉/后颈汗毛倒竖”、“手心全是冷汗/手心沁出黏腻冷汗”、“牙关紧咬/牙关咬得咯咯作响”等非自愿神经肌肉痉挛套话；必须置换为人物对外部器物的具体处置（如摔烟、滑落抓回、点不着火机）、直接内心利益算计或言语攻防策略（反问、打断、长久停顿）。
29. 严禁隐形 AI 翻译腔与假深沉修饰链（R-41）：严禁“在这一刻显得格外/尤为”、“无不在昭示着”、“带着一种不容置疑的”、“仿佛只要轻轻一碰就会……”、“与其说是 A 倒不如说是 B”等假大空假深沉的翻译腔修饰结构，回归干净利落的自然汉语白描。
30. 全管线商业单章篇幅硬标准（R-45）：所有题材管线无特别字数要求时，单章小说正文篇幅普遍必须严格控制在 2,000 ~ 3,000 汉字之间（黄金推荐区间 2,200 ~ 2,800 字，严禁低于 2,000 字，严禁超过 3,000 字）！去繁就简，镜头利落，坚决杜绝大段无痛风景贴图与清单碎碎念注水。
31. 严禁滥用“盯/盯住/死死盯着”制造虚假紧绷感（R-46）：严禁将普通的看、阅读、观察、打量、日常对话和事务交接过度代偿为“盯着/盯住/死死盯着”（如盯账簿、盯锅盖、盯硬币、盯门缝、盯对方脸庞）！此为规避“目光视线”后的典型 AI 虚假紧绷套路。日常场景坚决直接使用自然松弛的人类动词：“看”、“看着”、“看了看”、“打量”、“瞧了眼”、“瞅了一眼”、“扫了眼”。唯有真正的捕食狙击、敌意对峙等极少数生死语境方可克制使用“盯”，单章严禁超过 1 处。
32. 严禁变种指骨/骨节泛白套路（R-42）：严禁指节/指骨/骨节/关节/指尖/手背“泛白/变白/毫无血色/硌得发白/捏得发白/攥得发白”，改为具体处置外物动作或面部冷定神态。
33. 严禁机械节律脉动与抽动套路（R-43）：严禁“一下一下地收紧/抽痛/跳动/刺痛”、“顺着/随着脉搏跳动/抽搐”，回归连贯物理感受或环境压迫。
34. 严禁网游任务惩罚弹窗式四字通告（R-44）：严肃小说禁止突兀出现“违约者抽取生魂/当为矿奴/抹杀/炼入煞矿”等四字排比机械通告。
35. 严禁现代网剧相声式嘴炮互怼与乒乓球接梗（R-47）：严禁角色之间像现代都市恋爱喜剧或美剧相声一样一人一句互怼、接梗、抖机灵、打嘴炮（如“那你还不感动？”“我只担心你杀得不够快”等）；角色对白必须严格服从其身份门阀、阵营利害与真实城府，主角面对示好或挑衅应保持定力与利益算计，克制沉稳（如仅道“多谢”），智囊与巨头的机锋是道法破绽与眼神微变的高维审视，绝非小市民口舌之争。
36. 商业网文呼吸分段与反砖石大段规范（R-48）：严禁两个极端——既不可全篇单句单行（发报机碎片感）、亦不可超过 200 字未换行的大块实心砖石段；必须遵循“动作发起 - 碰撞爆发 - 场面与生理反馈”的三拍子呼吸律，单段以 2~4 个自然分句（60~120 汉字）为基准，重要宣言、惊天转折或新势力入场可独立成段呼吸，兼顾节奏感与移动阅读舒适度。
37. 战局立体因果闭环与反打卡空降援军（R-49）：严禁将大纲剧情节点写成流水账打卡（严禁上一幕同伴全成木头人挂件，下一幕主角开车突然偶遇火海强援）；任何强援入场与局势翻转前，必须完成“正面毁灭绝境 + 在场同伴分工截杀侧翼 + 强援从敌后战阵薄弱处突袭背刺”的战术因果闭环，形成环环相扣的立体战场。
38. 叙事纵深：老作者战力标尺与生存代价盘点（R-50）：严禁冷眼摄像机旁白与段末假深沉断言（如“裂口很小却改变战局”）；叙述者必须融入传统商业玄幻老作者从容深厚的大局观旁白，主动交代战力天花板对比（“连圣王都顶不住”）、同伴战损与生存依据（“抢到大量符箓才挺下来”）、关键利益底牌防备（“功德簿墙在手，随时可能倒戈”）以及高智商角色的微眼神心计破绽。

二、硬性质量规则
1. 物理与感官：声音、光线、动作、空间符合现场逻辑，不把声音、目光或情绪无故实体化。
2. 动词与句子：优先自然完整现代汉语动词，补齐主谓宾与必要音节，不造残句或生硬单字动词；补足量词与判断（“哄笑声一片”而非“哄笑一片”，“力量是真实存在的”而非“力量是真实的”，“喘得说不出一句完整的话”而非“喘得说不出整句”）。
3. 修饰节制：删同义重复、无功能副词、动作后的二次解释（如“脸色一沉”不再追加“又压了回去”）、无新信息的身体状态/时间/转场句；已用动作证明的事实不再旁白复述。
4. 情绪落地：由刺激→反应→（一层）判断，用动作/生理/选择/对白表现；严禁无理由破涕为笑等突变，不重复贴标签。
5. 对白有效：每句符合身份、关系、处境、目标；用称谓、语气、句长、打断、拒答形成区分，普通人物对白允许自然口语，不机械压成冷硬短句；反击台词体现底气与真实目标，不写成无力应付。
6. 指代清楚：关键动作用人名/具体对象，物证精确（如“鞋底的红泥”而非“鞋底带回去的东西”），避免亲属称谓、代词、“东西”等模糊指代造成误读。
7. 比喻审慎（好比喻四原则 + 比喻删除测试）：
   - 四原则：具体感官（触觉/痛觉/重量/温度） + 情境绑定 + 服务动作（速度/力度/画面） + 信息增量；
   - 执行“删除测试”：删去比喻后句意信息量若不降反清，必为装饰性废话直接删除；
   - 阈值：比喻词（仿佛/宛如/犹如/好似/像是/如/般）每章 ≤ 2 处，符合好比喻原则可放宽至 3~4 处，不符合任何原则即使一处也删。
8. 转折自然：“但/却/反而”两侧须有真实预期落差且改变判断/行动；轻描淡写语境可用“只不过”弱化转折；无功能则直接写动作或结果。
9. 人物主体：让人物或持有物承担动作，不为镜头感让“笔尖/目光/声音”等局部独立行动。
10. 制度先交代：人物第一次依制度/能力/限制行动，先交代名词对象、执行方式、触发条件与具体损失；其余随事件分散出现，不写百科段落。
11. 因果与证据：区分观察/怀疑/假设/确认/证明；线索不足时只表达当前信息边界（“不清楚、暂时无法确定”），不让主角提前替证据下方向性判断；单一迹象不得同时推来源、时间、动机、手段、唯一真相。
12. 紧迫场景：先处理最急行动/期限/危险；次要问题可略答、打断、延后，不写成整齐问答与申诉流程。
13. 思绪自然与因果节制（R-32）：允许省略、断续、一层判断；禁把“初衷→顾虑→触发→决定”完整写成报告，禁成对列尽利弊；严禁说明文式多层因果堆砌（R-32，“大概是……又有……才一直没有……”）；仅正式分析时可完整展开。
14. 反差有效：“却/但/反而”两侧须构成真实反差且影响人物判断或动作，否则直接写动作。
15. 句子功能：身体状态、转场、时间句必须新增行动限制或局势变化；已用动作证明的事实不再复述。
16. 群体反应：不用“所有人同时……”替代现场信息；选一两个有后果反应或展示分化。
17. 段落呼吸：对话短句若不构成节奏关键停顿应并入上下文；单句独立段（≤8字）每章不超过 3 处，仅保留场景转换与关键揭示；感官描写与紧随其后的角色决定之间不空行隔断。

三、输出前必扫
对照“最高指示”十二条 + 旁白越权 + 说明文解释限量 + 对比句清零 + 单句独立段超标，逐句回读；发现即用直接动作或平实陈述替代。

四、修改边界
保留事实、设定、剧情顺序、人物关系、有效术语、用户指定文风。只做已确认规则支持的最小修改；有效比喻、完整战术分析、有场景功能的群体反应或情绪直述可保留。完成后只返回最终正文。`;

const UNIVERSAL_CORRECTION_RULES = [
  { id: 'R-01-sensory-personification', label: '感官传播不准确/实体化', severity: 'high', manual: false, pattern: /(?:声音|低笑|冷笑|话音|叹息)(?:从|自)[^。！？\n]{0,24}(?:漏(?:出|来)?|飘(?:出|来)?|渗(?:入|出)?|飘忽不定|挤出)/g },
  { id: 'R-02-fragmented-verb', label: '动词缩写生硬', severity: 'medium', manual: false, pattern: /(?:颤|抖|顿|颤栗|抽搐)一下/g },
  { id: 'R-03-incomplete-phrase', label: '语句可能不完整', severity: 'medium', manual: false, pattern: /(?:哄笑一片|力量是真实的|是哥最大牵挂|在回应着他决心|喘得说不出整句)/g },
  { id: 'R-04-redundant-emotion', label: '动作后的情绪重复说明', severity: 'medium', manual: false, pattern: /[^。！？\n]{0,28}(?:满是|充满了|带着|写满)(?:心疼|无奈|紧张|忐忑|恐惧|愤怒|悲伤|担忧|决然|柔情)[^。！？\n]{0,18}/g },
  { id: 'R-05-formulaic-metaphor', label: '高风险套话比喻', severity: 'high', manual: false, pattern: /(?:如刀|如水|如渊|如纸|如雷|如电|如风|如雨|如林|如熊|如死灰|如重锤|如野火|如鬼魅|如断线风筝|如惊雷|如雷霆|如暴雨|如鸿毛|如泰山|如长河|如钉子钉进心头|如散落的棋子|如萤火|一柄出鞘的刀|月光如水|声淡如水|面沉如水|目光如刀|目光锐利如刀|冷硬如刀削|目光沉静如渊|深邃如渊|声音平静如水|泪如断线的珠子|像一潭死水|像谈天气|眉如刀削|目若寒星|寒星般的眸子|像一阵风|声音淡得像一阵风|像一头被逼到绝境的疯狗|像一条受了惊的丧家之犬|语气平得像在谈天气|如铁箍|如牛皮糖|凝练如铁|线条如铁|身形如风|快如风|如同鬼魅般|如鬼魅般|如断线风筝般|落在耳中如重锤|宛如重锤|如暴雨倾泻|如野火般蔓延|苍白如纸|惨白如纸|细密如砂|声音低沉如砂|声音低沉如鼓|像一柄钉子钉进心头|像一根钉子钉进心头|像一盘散落的棋子)/g },
  { id: 'R-06-postposed-state', label: '状态后置表达不自然', severity: 'medium', manual: false, pattern: /(?:笑|说|声音|语气|问)[^。！？\n]{0,8}得很(?:轻|淡|平静|冷)/g },
  { id: 'R-07-formulaic-crowd', label: '同步群体反应模板', severity: 'high', manual: false, pattern: /(?:所有人|全场|众人|整个大厅)[^。！？\n]{0,10}(?:都)?(?:愣住|沉默|哑然|死寂|倒吸一口凉气|惊呆)/g },
  { id: 'R-08-formulaic-reasoning', label: '工整二分或完整心理链', severity: 'medium', manual: false, pattern: /(?:不是[^。！？\n]{0,50}而是|若[^。！？\n]{0,35}则|轻则[^。！？\n]{0,25}重则|本想[^。！？\n]{0,60}(?:因为|看到|发现)[^。！？\n]{0,60}(?:于是|便|转而|改为))/g },
  { id: 'R-09-mechanical-body', label: '机械化身体状态说明', severity: 'medium', manual: false, pattern: /(?:双腿|手臂|身体|嗓子|声音)[^。！？\n]{0,12}(?:还能|依旧可以)(?:走|动|站|战斗|说话|发声)/g },
  { id: 'R-10-empty-adverb', label: '高风险空泛修饰', severity: 'low', manual: false, pattern: /淡淡地|平静地|轻轻地|猛然间|骤然间|竟然发现|幽深的|深邃的/g },
  { id: 'R-11-evidence-overclaim', label: '结论超过证据', severity: 'high', manual: false, pattern: /(?:已经证明|事实证明|显然就是|必然是|一定是|绝对是|无疑是|唯一真相|铁证如山|太恐怖了)/g },
  { id: 'R-12-decorative-quantity', label: '装饰性数量词', severity: 'medium', manual: false, pattern: /(?:一丝|一股|一种|一缕)(?:[^。！？\n]{0,8})(?:杀意|冷意|寒意|阴鸷|复杂|贪婪|深沉|威压|疲惫|玩味|挣扎|狠厉|心疼|无奈|疯狂|精芒|茫然|释然|温文尔雅|颤抖|惊惶|慌乱)/g },
  { id: 'R-13-artificial-body-subject', label: '局部替代人物主体', severity: 'low', manual: false, pattern: /(?:笔尖|目光|声音|指尖|唇角)[^。！？\n]{0,12}(?:停在|顿在|扫过|落在|做出|决定|勾起)/g },
  { id: 'R-14-template-smile', label: '模板化笑意动作', severity: 'high', manual: false, pattern: /(?:嘴角|唇角)[^。！？\n]{0,14}(?:勾起|微微勾起|缓缓勾起)[^。！？\n]{0,12}(?:一抹)?[^。！？\n]{0,10}(?:弧度|笑意|笑容|冷笑|阴狠|自得|意味难明)/g },
  { id: 'R-15-redundant-transition', label: '无功能转场或能力复述', severity: 'low', manual: false, pattern: /(?:双腿还能用|赶在[^。！？\n]{0,24}(?:之前|前)离开|终于明白|没有人敢说话|心里已经有了决定|脸上早已没了[^。！？\n]{0,10}不耐)/g },
  { id: 'R-16-lip-corner', label: '不自然用词“唇角”应改“嘴角”', severity: 'low', manual: false, pattern: /唇角/g },
  { id: 'R-17-dead-simile', label: '“死一般的”套话', severity: 'medium', manual: false, pattern: /死一般的|死一般/g },
  { id: 'R-18-sound-personification', label: '声音实体化变体', severity: 'high', manual: false, pattern: /(?:从齿缝里挤出|声音[^。！？\n]{0,10}飘忽不定|化作冰冷的凝重|化作[^。！？\n]{0,8}的(?:凝重|决绝))/g },
  { id: 'R-19-narrator-value-judgment', label: '旁白越权价值判断与过度惊叹', severity: 'high', manual: false, pattern: /(?:实在不值当|敷衍至极|成长速度太恐怖了|何其恐怖|何其骇人|是的，[^。！？\n]{0,20}太恐怖了)/g },
  { id: 'R-20-contrast-cliche', label: 'AI典型对比句装逼框架', severity: 'high', manual: false, pattern: /(?:普通人|常人|寻常人|旁人|外人)(?:未必能|根本无法|很难|难以)[^。！？\n]{0,20}(?:却太熟悉|却一眼看穿|却再熟悉不过|却心知肚明|却再清楚不过)/g },
  { id: 'R-21-abstract-wound-cliche', label: '伤势与感知抽象比喻套话', severity: 'medium', manual: false, pattern: /(?:像被重新凿了一遍|像被撕裂开来|像要炸开一般|像被万蚁噬咬|像一柄利刃直插)/g },
  { id: 'R-22-micro-timing-cliche', label: '微反应过度刻意计时', severity: 'low', manual: false, pattern: /(?:停了|顿了|僵了)(?:半息|一息|两息|数息)/g },
  { id: 'R-23-modern-legal-bureaucracy', label: '出戏的现代法务与行政职场黑话', severity: 'high', manual: false, pattern: /(?:证物链|涉案物|违规操作|流程闭环|顶层设计|颗粒度|KPI|打通底层|赋能)/g },
  { id: 'R-24-standup-comedy-quote', label: '现代段子与脱口秀感悟腔', severity: 'high', manual: false, pattern: /(?:坏事总能精准地|所谓的[^。！？\n]{0,10}不过是|这世上最[^。！？\n]{0,10}莫过于|或许这就是[^。！？\n]{0,10}的意义)/g },
  { id: 'R-25-tail-accounting-summary', label: '章尾账目盘点式机械复盘', severity: 'medium', manual: false, pattern: /(?:他损了|他赔了)[^。！？\n]{0,30}(?:毁了|折了)[^。！？\n]{0,30}(?:重铠|法器|银两)/g },
  { id: 'R-26-pseudo-cinematic-fragmentation', label: '拟声段落节奏观察，需结合上下文', severity: 'low', manual: true, pattern: /(?:^|\n)(?:咚|咔嚓|骨骼脆响|木头裂开|一声|两声|杀步)[。！？]?(?=\r?\n|$)/gm },
  { id: 'R-27-turn-taking-brawl', label: '动作戏回合制点名排队', severity: 'high', manual: false, pattern: /(?:最前一人|第一名|第二名|第三名|第四名|第五名)[^，。\n]{0,15}(?:横刀|砍向|冲来|逼近|趁隙|拔刀)/g },
  { id: 'R-28-binary-symmetry', label: '工整对称二分句式', severity: 'medium', manual: false, pattern: /(?:一枚[^，。！？\n]{1,15}，一枚|第一步[^，。！？\n]{1,15}，第二步|只剩半边[^，。！？\n]{0,10}另一半|三只[^，。！？\n]{1,15}只有(?:靠|一))/g },
  { id: 'R-29-slogan-dialogue', label: '角色口号复读与标签台词', severity: 'high', manual: false, pattern: /(?:老子护账|护账不护脑袋|别见血[^，。！？\n]{0,8}见了血|捅死了算你家祖坟)/g },
  { id: 'R-30-lore-announcement', label: '旁白招式报幕与设定弹窗', severity: 'medium', manual: false, pattern: /(?:杀步。|那是[^，。\n]{2,12}常用的(?:引煞线|押煞器|法器)|那是押煞器|是押煞器)/g },
  { id: 'R-31-sensory-checklist-loop', label: '生理痛觉指标循环播报', severity: 'medium', manual: false, pattern: /(?:砂粒便往发白的脚掌肉里磨|脚掌被靴底砂石磨开|撕裂的皮肉被靴内积水浸透)/g },
  { id: 'R-32-stacked-explanation', label: '说明文式多层因果堆砌', severity: 'medium', manual: false, pattern: /(?:大概是|或许是)[^。！？\n]{0,30}(?:又有|又有.*在附近)[^。！？\n]{0,30}(?:才一直没有|才一直没)/g },
  { id: 'R-33-pseudo-precision', label: '伪精确数字与死板步数', severity: 'high', manual: false, pattern: /(?:每隔[三四五六七八九十]步|北偏东\d+度|下降超过\d+丈|长约[七八九]尺|宽不到半尺)/g },
  { id: 'R-34-formulaic-wound-tight', label: '套路化伤势感知（旧伤发紧）', severity: 'high', manual: false, pattern: /(?:旧伤[^。！？\n]{0,10}发紧|旧伤在寒气里发紧|疼痛沿着骨缝往上爬)/g },
  { id: 'R-35-breath-countdown', label: '战斗动作戏秒表倒数', severity: 'high', manual: false, pattern: /第[一二三四五六七八九十]息[，、]/g },
  { id: 'R-36-pupil-dilation-cliche', label: '套路化瞳孔反应', severity: 'medium', manual: false, pattern: /瞳孔(?:放大|收缩|猛然收缩|骤缩)/g },
  { id: 'R-37-mechanical-reflex-impact', label: '神经反射式受击震颤套话', severity: 'high', manual: false, pattern: /(?:震得|震得那?)(?:脚底|双脚|双腿|脚掌|虎口|手臂|手腕|指尖|指节|胸口|内脏|五脏|耳膜|耳角|脑仁|浑身|全身|整个人)(?:发麻|发木|发颤|生疼|剧痛|发酸|酸麻|刺痛|嗡嗡|翻涌|发紧)|喉头一甜|气血翻涌|只觉得一股凉气从脚底/g },
  { id: 'R-38-game-meter-ticking', label: '战斗中机械数值打卡/跳字', severity: 'high', manual: false, pattern: /(?:气血|战力|力量|敏捷|体质)(?:测试仪|测试器|数值|读数|指标)?(?:连续)?(?:跳动|暴涨|飙升|停在|从|在)[^。！？\n]{0,20}[0-9\d一二三四五六七八九十百]+(?:卡|点|%)?(?:[，、\s]{0,5}(?:跳到|跳至|升到|达到|破了|飙到)\s*[0-9\d一二三四五六七八九十百]+(?:卡|点|%)?)?/g },
  { id: 'R-39-staccato-subject-monotony', label: '主角名连续主语发报机句式', severity: 'medium', manual: false, pattern: /(?:^|\n)\s*([^\s，。！？\n]{2,4})[^\n。！？]{1,20}[。！？]\s*\1[^\n。！？]{1,20}[。！？]\s*\1[^\n。！？]{1,20}[。！？]/g },
  { id: 'R-40-somatic-reflex-cliche', label: '植物神经/微小肌群痉挛套路（喉咙发紧/指节泛白/心跳漏拍）', severity: 'high', manual: false, pattern: /(?:喉咙|喉头)(?:发紧|一阵发紧)|指节(?:泛白|捏得发白|发白)|呼吸(?:骤然|猛然|不由得)?一滞|心跳(?:猛然|骤然)?漏了一拍|心跳漏了半拍|下颌(?:线)?(?:骤然)?(?:绷紧|收紧)|后颈(?:发凉|汗毛倒竖)|手心(?:沁出|全是)?(?:黏腻的)?冷汗|牙关紧咬|牙关咬得咯咯作响/g },
  { id: 'R-41-hidden-translationese', label: '隐形翻译腔与假深沉修饰链', severity: 'high', manual: false, pattern: /在这一刻显得(?:格外|尤为)|无不在昭示着|带着一种不容置疑的|仿佛只要轻轻一碰(?:，)?就会|与其说是[^，。\n]{1,15}(?:，)?倒不如说是/g },
  { id: 'R-42-bone-whitening-mutation', label: '变种指骨/骨节/关节泛白套路', severity: 'high', manual: false, pattern: /(?:指节|指骨|骨节|关节|指尖|指头|手指|手背|手面)[^，。\n]{0,8}(?:泛白|发白|变白|毫无血色|失去血色|硌得发白|捏得发白|攥得发白)/g },
  { id: 'R-43-rhythmic-pulsing-cliche', label: '机械节律脉动与抽动套路', severity: 'high', manual: false, pattern: /(?:一下一下地?)(?:收紧|抽痛|跳动|刺痛|挤压)|(?:顺着|随着)脉搏[^，。\n]{0,10}(?:收紧|跳动|抽搐|缩紧)/g },
  { id: 'R-44-quest-penalty-staccato', label: '网游任务惩罚弹窗式四字通告', severity: 'high', manual: false, pattern: /(?:若违约|违约者|如若违背|违契者)[，,]?(?:抽取生魂|当为矿奴|抹杀|扣除|炼入煞矿)/g },
  { id: 'R-45-chapter-length-standard', label: '商业单章篇幅硬标准（2000~3000字，当前已超标）', severity: 'high', manual: false, pattern: /(?:[\s\S]{3001,})/g },
  { id: 'R-46-excessive-staring-cliche', label: '滥用盯/盯住制造虚假紧张感', severity: 'medium', manual: false, pattern: /(?:死死盯住?|冷冷盯住?|重新盯住?|眼神盯住?|目光盯住?|双眼盯住?|两眼盯住?|蹲在[^，。\n]{0,10}盯[着住]|低头盯[着住]|抬眼盯[着住]|坐着盯[着住]|站着盯[着住])/g },
  { id: 'R-47-banter-pingpong-cliche', label: '网剧相声式嘴炮互怼与接梗', severity: 'high', manual: false, pattern: /(?:那你还不感动|我只担心你杀得不够快|你对我始终没有信任|你若是我，?也不会信任自己|你不是一直在躲我吗|这还不够证明真心)/g },
  { id: 'R-48-brick-paragraph-cliche', label: '反砖石大段与断崖单句', severity: 'medium', manual: false, pattern: /(?:^|\n)[^\n]{250,}(?=\r?\n|$)/gm },
  { id: 'R-49-isolated-airdrop-rescue', label: '无因果铺垫的空降偶遇救场', severity: 'medium', manual: false, pattern: /(?:突然在前方出现了一片|开着车突然看到|偶遇了一片火海|突然巧合地出现在正前方)/g },
  { id: 'R-50-narrator-depth-deprivation', label: '段末假深刻断言金句', severity: 'medium', manual: false, pattern: /(?:却足够改变战局|这女人杀得太狠。而且，她出现得太巧|谁都没有退让。)/g }
];

function scanUniversalCorrectionRisks(text, options) {
  const source = String(text == null ? '' : text);
  const limit = Math.max(1, Math.min(200, Number(options && options.limit) || 64));
  const findings = [];
  const matchedRuleIds = [];
  const library = options && options.library === false ? null : (options && options.library || getCorrectionLibrary());
  const seenSpans = new Set();
  // 题材分层：传入 genre 时按 lib/genre-rule-scope 过滤仅对特定题材成立的规则，避免误伤范本写法。
  let activeRules = UNIVERSAL_CORRECTION_RULES;
  let skippedRules = [];
  let genreFamily = 'unknown';
  if (options && options.genre) {
    try {
      const scoped = require('./lib/genre-rule-scope').filterCorrectionRules(UNIVERSAL_CORRECTION_RULES, options.genre);
      activeRules = scoped.rules;
      skippedRules = scoped.skipped;
      genreFamily = scoped.family;
    } catch (_) { activeRules = UNIVERSAL_CORRECTION_RULES; }
  }
  for (const rule of [...activeRules, ...libraryScanRules(library)]) {
    if (rule.manual || !rule.pattern || rule.pattern.source === '(?!') continue;
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) {
      if (findings.length >= limit) break;
      const value = String(match[0] || '').trim();
      if (!value) continue;
      const index = Number(match.index) || 0;
      // 库派生规则与人工正则命中同一片段时只保留人工正则的一条。
      const spanKey = index + ':' + value.length;
      if (rule.origin && seenSpans.has(spanKey)) continue;
      seenSpans.add(spanKey);
      const finding = { ruleId: rule.id, label: rule.label, severity: rule.severity, text: value.slice(0, 120), index };
      if (library) {
        const suggestion = correctionLibrary.suggestionForFinding(library, finding);
        if (suggestion) finding.suggestion = suggestion;
      }
      findings.push(finding);
      if (!matchedRuleIds.includes(rule.id)) matchedRuleIds.push(rule.id);
    }
    if (findings.length >= limit) break;
  }
  const metrics = correctionLibrary.measureCorrectionMetrics(source);
  if (metrics.chars > 3000 || (options && (options.isChapter || options.chapterMode) && metrics.chars < 2000)) {
    if (!matchedRuleIds.includes('R-45-chapter-length-standard')) {
      const finding = {
        ruleId: 'R-45-chapter-length-standard',
        label: '商业单章篇幅硬标准（2000~3000字）',
        severity: 'high',
        text: metrics.chars > 3000 ? `正文字数已达 ${metrics.chars} 字，超过 3000 汉字硬上限` : `正文字数仅 ${metrics.chars} 字，不足 2000 汉字下限`,
        index: Math.min(3000, source.length)
      };
      if (library) {
        const suggestion = correctionLibrary.suggestionForFinding(library, finding);
        if (suggestion) finding.suggestion = suggestion;
      }
      findings.push(finding);
      matchedRuleIds.push('R-45-chapter-length-standard');
    }
  }
  findings.sort((a, b) => a.index - b.index);
  const repetition = correctionLibrary.scanRepetition(source, options && options.priorText || '', correctionLibrary.repetitionWatchlist(library));
  const needsReview = findings.length > 0 || metrics.exceeded.length > 0 || repetition.length > 0;
  return {
    version: UNIVERSAL_CORRECTION_POLICY_VERSION,
    libraryVersion: library ? library.version : '',
    enabled: true,
    status: needsReview ? 'needs_review' : 'passed',
    findings,
    matchedRuleIds,
    findingCount: findings.length,
    metrics,
    repetition,
    genre: options && options.genre ? String(options.genre) : '',
    genreFamily,
    skippedRuleIds: skippedRules.map(item => item.id),
    checkedAt: Date.now()
  };
}

function emptyCorrectionAudit(enabled = false) {
  return {
    version: UNIVERSAL_CORRECTION_POLICY_VERSION,
    libraryVersion: '',
    enabled: !!enabled,
    status: enabled ? 'not_checked' : 'disabled',
    findings: [],
    matchedRuleIds: [],
    findingCount: 0,
    metrics: null,
    repetition: [],
    checkedAt: null
  };
}

// 《纠错库.md》候选路径：环境变量 > 云端 release > 本地开发副本 > 随仓库打包副本。
const CORRECTION_LIBRARY_FILE_CANDIDATES = [
  process.env.MOLAN_EDITOR_CORRECTION_LIBRARY_FILE || '',
  '/opt/molan/editor-sources/纠错库.md',
  'C:/Users/lyh/Desktop/小说专属网页/纠错库.md',
  path.join(__dirname, 'editor-sources', '纠错库.md')
];

function resolveCorrectionLibraryFile(preferred) {
  for (const candidate of [preferred || '', ...CORRECTION_LIBRARY_FILE_CANDIDATES]) {
    const value = String(candidate || '').trim();
    if (!value) continue;
    try { if (fs.statSync(value).isFile()) return value; } catch (_) {}
  }
  return '';
}

let libraryLoadError = null;
function getCorrectionLibrary(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, 'data', 'correction-library');
  if (fs.existsSync(path.join(dataDir, 'rules.json')) && options.preferMarkdown !== true) {
    try {
      const fromData = correctionLibrary.loadCorrectionLibraryFromData(dataDir, options);
      if (fromData) {
        libraryLoadError = null;
        return fromData;
      }
    } catch (_) {}
  }
  const file = resolveCorrectionLibraryFile(options.file);
  if (!file) { libraryLoadError = new Error('纠错库.md 不存在'); return null; }
  try {
    libraryLoadError = null;
    return correctionLibrary.loadCorrectionLibrary(file, options);
  } catch (error) {
    libraryLoadError = error;
    return null;
  }
}

function correctionLibraryLoadError() { return libraryLoadError; }

let scanRulesCache = { version: '', rules: [] };
function libraryScanRules(library) {
  if (!library) return [];
  if (scanRulesCache.version === library.version) return scanRulesCache.rules;
  const rules = correctionLibrary.buildLibraryScanRules(library);
  scanRulesCache = { version: library.version, rules };
  return rules;
}

/**
 * 渲染分档 prompt：核心档（本文件 PROMPT）+ 黑名单短语 + 场景规则；
 * includeCases=true（默认）时追加同类案例；改稿语境再追加用户手动纠正对照档。
 * 通用链路应传 includeCases:false，保持项目中立。
 */
function renderCorrectionPolicyPrompt(requestText, options = {}) {
  const library = options.library === false ? null : (options.library || getCorrectionLibrary());
  if (!library) {
    return { text: UNIVERSAL_CORRECTION_POLICY_PROMPT, mode: 'draft', scenes: [], caseIds: [], referenceCount: 0, libraryVersion: '', includeCases: false };
  }
  return correctionLibrary.renderCorrectionPrompt(library, UNIVERSAL_CORRECTION_POLICY_PROMPT, requestText, options);
}

module.exports = {
  UNIVERSAL_CORRECTION_POLICY_VERSION,
  UNIVERSAL_CORRECTION_POLICY_PROMPT,
  UNIVERSAL_CORRECTION_RULES,
  CORRECTION_LIBRARY_FILE_CANDIDATES,
  resolveCorrectionLibraryFile,
  getCorrectionLibrary,
  correctionLibraryLoadError,
  libraryScanRules,
  renderCorrectionPolicyPrompt,
  scanUniversalCorrectionRisks,
  emptyCorrectionAudit
};
