# -*- coding: utf-8 -*-
"""按目标角色从已下载原文中提取描写句段，标记类型（语言/神态/动作/外貌/心理），输出结构化 JSON 与统计"""
import json
import os
import re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raws")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extracted")
os.makedirs(OUT, exist_ok=True)

# 每本书的簿/角色名映射：目录 -> (书名, {别名: 规范角色名})
# 注意别名匹配按最长优先，避免"明兰"误匹配"盛明兰"
BOOKS = {
    "2456_何以笙箫默": ("《何以笙箫默》顾漫", {
        "何以琛": "何以琛", "以琛": "何以琛", "何律师": "何以琛",
        "赵默笙": "赵默笙", "默笙": "赵默笙",
        "何以玫": "何以玫",
    }),
    "370832_微微一笑很倾城": ("《微微一笑很倾城》顾漫", {
        "肖奈": "肖奈", "奈何": "肖奈",
        "贝微微": "贝微微", "微微": "贝微微",
        "二喜": "二喜", "晓玲": "晓玲", "丝丝": "丝丝",
    }),
    "247098_杉杉来吃": ("《杉杉来吃》顾漫", {
        "封腾": "封腾", "总裁": "封腾",
        "薛杉杉": "薛杉杉", "杉杉": "薛杉杉",
    }),
    "3429203_你是我的荣耀": ("《你是我的荣耀》顾漫", {
        "于途": "于途",
        "乔晶晶": "乔晶晶", "晶晶": "乔晶晶",
        "亮亮": "亮亮",
    }),
    "931329_知否知否应是绿肥红瘦": ("《知否知否应是绿肥红瘦》关心则乱", {
        "盛明兰": "盛明兰", "明兰": "盛明兰", "六姑娘": "盛明兰",
        "盛老太太": "盛老太太", "老太太": "盛老太太", "祖母": "盛老太太",
        "顾廷烨": "顾廷烨",
        "齐衡": "齐衡", "小公爷": "齐衡",
        "如兰": "如兰",
        "墨兰": "墨兰",
        "王氏": "王氏", "王大娘子": "王氏",
        "林噙霜": "林噙霜", "林姨娘": "林噙霜", "林小娘": "林噙霜",
        "康姨妈": "康姨妈",
        "孔嬷嬷": "孔嬷嬷",
        "长柏": "长柏",
    }),
}

# 五类描写特征词
TYPES = {
    "语言": ["说", "道", "问", "答", "喊", "叫", "唤", "应", "开口", "开言", "接话", "回", "喝问",
             "沉声道", "冷声道", "轻声道", "温声道", "喝道", "吼道", "哼道", "接口", "抢白",
             "平静地", "淡淡道", "冷冷道", "笑道", "叹道"],
    "神态": ["神色", "神情", "脸色", "面色", "表情", "神态", "面容", "眼里", "眼中", "目光", "眼神",
             "眉", "眯", "瞟", "瞥", "瞪", "挑眉", "扬眉", "垂眸", "眸", "笑", "皱眉", "蹙",
             "面色铁青", "阴沉", "冷", "淡", "温", "怒", "喜", "惊", "怔", "愣", "尴尬", "窘",
             "不屑", "嫌恶", "温柔", "平和"],
    "动作": ["转身", "站起", "站", "坐", "走", "回", "拍", "攥", "捏", "咬", "垂", "低", "抬", "扬",
             "勾", "弯", "伸手", "一把", "轻", "缓", "慢慢", "立刻", "猛地", "握", "合上", "拉开",
             "皱眉", "起身", "离座", "入座", "端", "抿", "舔", "咽", "撇", "点/头", "摇/头"],
    "外貌": ["容貌", "相貌", "长相", "身高", "身量", "身材", "五官", "模样", "脸蛋", "面容", "皮肤",
             "眉眼", "一双", "头发", "发", "薄唇", "嘴唇", "衣着", "穿着", "打扮", "好看", "帅气",
             "俊朗", "俊美", "清秀", "漂亮", "美人", "气度"],
    "心理": ["心想", "心里想", "暗自", "暗道", "心中", "心里", "暗想", "心道", "想", "盘算", "琢磨",
             "思量", "暗自嘀咕", "暗忖", "心念", "不禁", "忍不住", "默默"],
}


def split_paras(text):
    """按换行拆自然段并清理"""
    paras = [p.strip() for p in re.split(r"\n+", text) if p.strip()]
    return paras


def detect_types(seg):
    """判断段落命中的描写类型"""
    hit = []
    for tname, words in TYPES.items():
        for w in words:
            if w in seg:
                hit.append(tname)
                break
    return hit


def match_chars(seg, aliases):
    """返回段落中最长的命中角色（按别名字长降序，取第一个命中）"""
    matched = []
    # 按别名长度降序匹配，避免"明兰"先于"盛明兰"
    for alias in sorted(aliases, key=len, reverse=True):
        if alias in seg:
            matched.append(aliases[alias])
    # 去重
    return list(dict.fromkeys(matched))


def main():
    all_stats = {}
    for book_dir in sorted(os.listdir(ROOT)):
        d = os.path.join(ROOT, book_dir)
        if not os.path.isdir(d):
            continue
        if book_dir not in BOOKS:
            continue
        book_name, aliases = BOOKS[book_dir]
        char_count = {c: {"seg": 0, "chars": 0, "types": {t: 0 for t in TYPES}} for c in set(aliases.values())}
        records = []
        seen = set()
        for f in sorted(os.listdir(d)):
            if not f.endswith(".txt"):
                continue
            with open(os.path.join(d, f), encoding="utf-8") as fh:
                text = fh.read()
            for para in split_paras(text):
                seg = para
                if len(seg) < 15:  # 过短跳过
                    continue
                chars = match_chars(seg, aliases)
                if not chars:
                    continue
                types = detect_types(seg)
                if not types:  # 非描写句（纯对话推进/剧情）跳过，只保留描写
                    continue
                # 去重键
                key = (f, chars[0], seg)
                if key in seen:
                    continue
                seen.add(key)
                for c in chars:
                    char_count[c]["seg"] += 1
                    char_count[c]["chars"] += len(seg)
                    for t in types:
                        char_count[c]["types"][t] += 1
                records.append({"chap": f, "chars": chars, "types": types, "seg": seg})
        with open(os.path.join(OUT, book_dir + ".json"), "w", encoding="utf-8") as fh:
            json.dump({"book": book_name, "records": records}, fh, ensure_ascii=False, indent=1)
        all_stats[book_dir] = {"book": book_name, "chars": {c: {"seg": v["seg"], "chars": v["chars"], "types": v["types"]}
                                                           for c, v in char_count.items()}}
        print(f"{book_dir} 记录数={len(records)}")
        for c, v in char_count.items():
            print(f"    {c}: {v['seg']}段/{v['chars']}字  类型{v['types']}")

    with open(os.path.join(OUT, "_stats.json"), "w", encoding="utf-8") as fh:
        json.dump(all_stats, fh, ensure_ascii=False, indent=1)
    print("EXTRACT DONE")


if __name__ == "__main__":
    main()