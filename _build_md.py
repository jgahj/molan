# -*- coding: utf-8 -*-
"""将提取的人物描写按10类性格分类，每类内按 外貌/神态/动作/语言/心理 五维度分隔，生成最终 MD 素材库"""
import json
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extracted")

# 分类 -> 该性格所包含的角色（角色名必须与 BOOKS aliases 中的规范名一致）
CATEGORIES = [
    ("一、高冷禁欲 · 冰山腹黑男主", ["肖奈", "封腾"]),
    ("二、温柔深情 · 内敛担当男主", ["何以琛", "于途"]),
    ("三、爽朗直率 · 阳光女主", ["赵默笙", "贝微微"]),
    ("四、软萌可爱 · 甜系吃货", ["薛杉杉"]),
    ("五、聪慧机敏 · 明艳大女主", ["乔晶晶"]),
    ("六、聪慧灵慧 · 沉着庶女（古言大女主）", ["盛明兰"]),
    ("七、老辣睿智 · 幕后长辈大佬", ["盛老太太", "孔嬷嬷"]),
    ("八、心机白莲 · 绿茶女配", ["林噙霜", "墨兰"]),
    ("九、娇蛮任性 · 跋扈千金 / 当家主母", ["如兰", "王氏"]),
    ("十、温润深情 · 谦谦君子（男二型）", ["齐衡", "长柏"]),
]

TYPE_ORDER = ["外貌", "神態", "动作", "语言", "心理"]
# 中文节名
TYPE_TITLE = {"外貌": "外貌描写", "神态": "神色与神态描写", "动作": "动作与举止描写",
              "语言": "语言与对话描写", "心理": "心理活动描写"}
# 提取脚本中使用的类型标识，避免"神态"简繁混淆
TYPE_KEYS = {"外貌": "外貌", "神态": "神态", "动作": "动作", "语言": "语言", "心理": "心理"}


def load_records():
    """汇总所有书籍的记录，建立 角色 -> [record,...] 索引"""
    index = {}
    for fn in os.listdir(OUT_DIR):
        if not fn.endswith(".json") or fn.startswith("_"):
            continue
        with open(os.path.join(OUT_DIR, fn), encoding="utf-8") as fh:
            data = json.load(fh)
        book = data["book"]
        for rec in data["records"]:
            for c in rec["chars"]:
                index.setdefault(c, [])
                item = dict(rec)
                item["book"] = book
                index[c].append(item)
    return index


def main():
    index = load_records()
    lines = []
    lines.append("# 网络小说人物描写素材库（真实原文提取）\n")
    lines.append(
        "> 本素材库所有内容均摘自**已完结中文网络小说原文**（顾漫《何以笙箫默》《微微一笑很倾城》"
        "《杉杉来吃》《你是我的荣耀》、关心则乱《知否知否应是绿肥红瘦》），"
        "为**真实抓取的人物描写句段**，非 AI 拼接生成。"
        "按 10 类网文常用性格人设分类，每类内进一步按 **外貌 / 神态 / 动作 / 语言 / 心理** 五个描写维度分隔，"
        "可直接摘引用于自己的小说写作。\n"
    )
    lines.append("---\n")

    for cat_title, chars in CATEGORIES:
        lines.append(f"\n## {cat_title}\n")
        # 每类统计字数
        cat_seg_count = 0
        cat_char_count = 0
        # 五维度小节
        for t in TYPE_KEYS:
            lines.append(f"\n### 「{TYPE_TITLE[t]}」\n")
            type_seg = 0
            type_char = 0
            for char in chars:
                recs = [r for r in index.get(char, []) if t in r["types"]]
                if not recs:
                    continue
                lines.append(f"\n**◇ {char}（{recs[0]['book']}）**\n")
                for i, r in enumerate(recs, 1):
                    seg = r["seg"].replace("\xa0", " ")
                    lines.append(f"{i}. {seg}\n")
                    type_seg += 1
                    type_char += len(seg)
            lines.append(f"\n*（本小节共 {type_seg} 段 / 约 {type_char} 字）*\n")
            cat_seg_count += type_seg
            cat_char_count += type_char
        lines.append(f"\n**【该类合计】共 {cat_seg_count} 条描写 / 约 {cat_char_count} 字**\n")

    md_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "人物描写素材库.md")
    with open(md_path, "w", encoding="utf-8") as fh:
        fh.write("".join(lines))
    print("已生成:", md_path, "总行数:", len(lines))

    # 打印每类字数汇总
    for cat_title, chars in CATEGORIES:
        total = 0
        for char in chars:
            for rec in index.get(char, []):
                total += len(rec["seg"])
        flag = "" if total >= 10000 else "  <-- 不足1万字!"
        print(f"{cat_title}: 约 {total} 字{flag}")


if __name__ == "__main__":
    main()