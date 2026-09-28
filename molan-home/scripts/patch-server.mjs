import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('molan-home/server.js');
let code = fs.readFileSync(file, 'utf8');

const crlf = code.includes('\r\n');
const nl = crlf ? '\r\n' : '\n';

const boundaryStart = code.indexOf("    '【改写边界（必须遵守）】',");
const boundaryEnd = code.indexOf("  ].join('\\n'));\n  return [", boundaryStart);

if (boundaryStart === -1 || boundaryEnd === -1) {
  console.error('未找到改写边界区域', boundaryStart, boundaryEnd);
  process.exit(1);
}

const newBoundaries = [
  "    '【改写边界（必须遵守）】',",
  "    '1. 保持剧情主干、核心情境与人物立场：修补初稿中的叙事断层与前后矛盾，修正违背基本生活常识与物理常识的悬浮动作；修补需顺理成章、行云流水，杜绝刻意跳出故事解释道具台账的打卡感。',",
  "    '2. 道具与状态时空自洽：文牒、信物、兵刃、伤势等关键要素前后连贯，严禁前文收起后文凭空在他人手中复现的穿帮；生死关头动机合理，严禁死斗中突兀停战演讲。',",
  "    '3. 注入主角主观心理流（Deep POV）：丰富主要角色的内心思考、敏锐判断与情绪呼吸，让读者身临其境感知危险、算计与抉择，坚决杜绝木偶工具人。',",
  "    '4. 彻底剔除假文青与修辞通胀（核心去AI味）：坚决删掉无病呻吟的做作通感比喻（严禁动辄出现“像发胀棉絮/像劣茶/像熬焦旧钱/像死鱼眼珠”等矫饰），换为干净利落、画面感极强的直接白描与动作推进。',",
  "    '5. 彻底清零装饰性数量词：严禁“一丝/一股/一种/一缕 + 情绪/冷意/贪婪/寒意/杀意”，转化为具体的生理反应（如后背发凉、牙关咬紧）、神态变化或环境事实。',",
  "    '6. 严禁局部替代人物主体：严禁“目光落在/视线投向/眼神扫过/目光停在”等套话，必须直接写人物行为（如“他看着/他盯着/他打量”）。',",
  "    '7. 优化对白潜台词与阶级机锋：对白要有试探、留白与动作节拍，去除说明书式的自报家门与假大空口号；严禁生死搏杀时突兀打官腔。',",
  "    '8. 严禁视听分镜式单句成段：严禁将推论或心理定格（如“这是暗语。”“他没有退。”“某某看懂了。”）单独成行成段，必须自然融入连续叙事中；全章纯叙述单句成段≤2处。',",
  "    '9. 叙事节奏清爽凌厉，打破匀速平推：动作交锋主次分明，次要过招顺笔带过，关键破局浓墨重彩，长短句错落有致，让阅读充满爽快感与张力。',",
  "    '10. 超凡与危机展现具备真实震撼感：写出超自然力量带来的认知撕裂、不可名状压迫或排山倒海的视觉冲击，杜绝廉价光效。',",
  "    '11. 直接输出改写后的正文，不要任何解释、前言或 Markdown 围栏。'"
].join(nl);

code = code.slice(0, boundaryStart) + newBoundaries + code.slice(boundaryEnd);

fs.writeFileSync(file, code, 'utf8');
console.log('✓ server.js 改写边界更新完成！');
