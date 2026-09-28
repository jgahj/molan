# -*- coding: utf-8 -*-
"""Discover: 按 18 题材类型 + 热度(积分)优先，收集晋江 免费+完结 候选书列表，输出 types_novels.json"""
import gzip
import json
import os
import re
import ssl
import time
import urllib.parse
import urllib.request

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
COOKIE = "testcookie=yes; smidV2=202608252009511fbfaf43a6b46b38df03c8bedb1c41ce00e637a23b6f74bb0; JJEVER=%7B%22shumeideviceId%22%3A%22WHJMrwNw1k/EVuGXUmHfkIzIXWcssqukodQZxMWU2jelG7JcZ0/08DJw6EJLz4d4AYPcrbka4u/vXpds0hK8Bpoe5ZQOWaAcvdCW1tldyDzmQI99+chXEimae3WVKreby9lCUKKcsmkSqmJzoPeggwzYmmmXo8LlTkQE5YcNLqNriNYPfoOP/bjqNkCQ56lOWi2XQGU8B3VOESR7s+OEsxynovXXLjYfIJKaQLlUH5oDnJ6SIZnD9cQOqmR+wvvl8F10/rPYNoNw%3D1487582755342%22%7D"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Referer": "https://www.jjwxc.net/",
    "Cookie": COOKIE,
    "Accept-Encoding": "gzip, deflate",
}
BASE = "https://www.jjwxc.net/bookbase.php?"

# 18 题材类型 -> 多个候选查询参数（fw=6 免费；sortType=2 积分热度最高优先）
CATE = {
    "玄幻": [{"lx": "3"}, {"lx": "3", "xx": "1"}],
    "奇幻": [{"lx": "3"}],
    "武侠": [{"lx": "2"}],
    "仙侠": [{"lx": "4"}],
    "都市": [{"sd": "1", "lx": "1"}, {"sd": "1"}],
    "现实": [{"sd": "1", "lx": "16"}, {"sd": "1"}],
    "游戏": [{"lx": "5"}],
    "体育": [{"lx": "16", "bq": "体育"}, {"lx": "5"}],
    "科幻": [{"lx": "7"}],
    "悬疑": [{"lx": "10"}],
    "轻小说": [{"lx": "17"}],
    "言情": [{"xx": "1"}],
    "推理": [{"lx": "10", "bq": "悬疑"}, {"lx": "10"}],
    "惊悚": [{"lx": "9"}],
    "纪实": [{"lx": "16", "sd": "1"}, {"sd": "1"}],
    "动漫": [{"lx": "18"}, {"lx": "19"}],
    "乡土": [{"lx": "16", "sd": "1"}, {"sd": "1"}],
    "耽美": [{"xx": "2"}],
}
# 每类型至少收多少候选（供下载阶段筛选可用书）
TARGET = 40


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=25, context=CTX) as resp:
        raw = resp.read()
    if resp.headers.get("Content-Encoding") == "gzip":
        raw = gzip.decompress(raw)
    return raw.decode("gb18030", errors="ignore")


def parse_books(html):
    """从书库页解析 (novelid, 标题, 状态描述)"""
    out = []
    # 匹配书籍行：链接 + 状态（连载中/完结）
    for m in re.finditer(r'onebook\.php\?novelid=(\d+)"[^>]*>([^<]+)</a>', html):
        nid = int(m.group(1))
        title = m.group(2).strip()
        out.append((nid, title))
    return out


def discover_type(tname, queries, max_pages=4):
    """抓取某类型多个查询的积分序书库页，收集候选（按热度先后顺序去重）"""
    seen = {}
    seen_title = {}
    order = []
    for qi, qpart in enumerate(queries):
        seen_q = set()
        for page in range(1, max_pages + 1):
            p = dict(qpart)
            p["fw"] = "6"
            p["sortType"] = "2"  # 积分热度
            if page > 1:
                p["page"] = str(page)
            qs = urllib.parse.urlencode(p)
            url = BASE + qs
            try:
                html = fetch(url)
            except Exception as e:
                print(f"  [{tname}] q{qi} page{page} 失败 {e}")
                time.sleep(1)
                break
            books = parse_books(html)
            if not books:
                break
            for nid, title in books:
                if nid in seen_q:
                    continue
                seen_q.add(nid)
                if nid not in seen:
                    seen[nid] = title
                    order.append((nid, title))
            time.sleep(0.3)
    return order


def main():
    ROOT = os.path.dirname(os.path.abspath(__file__))
    result = {}
    for tname, queries in CATE.items():
        order = discover_type(tname, queries)
        result[tname] = [{"novelid": nid, "title": title} for (nid, title) in order]
        print(f"[{tname}]: 候选 {len(order)} 本，前8本:", [t[:18] for _, t in order[:8]])
        time.sleep(0.4)

    with open(os.path.join(ROOT, "types_novels.json"), "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=1)
    print("== 已保存 types_novels.json ==")


if __name__ == "__main__":
    main()