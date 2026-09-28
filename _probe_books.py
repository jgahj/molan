# -*- coding: utf-8 -*-
"""探测晋江候选书目的免费(未锁定)章节数，用于规划抓取书单"""
import gzip
import re
import ssl
import time
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


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20, context=CTX) as resp:
        raw = resp.read()
    if resp.headers.get("Content-Encoding") == "gzip":
        raw = gzip.decompress(raw)
    return raw.decode("gb18030", errors="ignore")


# 书名 -> novelid
BOOKS = {
    2456: "何以笙箫默",
    370832: "微微一笑很倾城",
    247098: "杉杉来吃",
    3429203: "你是我的荣耀",
}

for novelid, name in BOOKS.items():
    try:
        html = fetch(f"https://www.jjwxc.net/onebook.php?novelid={novelid}")
        title_m = re.search(r"<title>(.*?)</title>", html, re.S)
        # 免费章节 = 含 chapterid 链接的行
        free = set(re.findall(r"chapterid=(\d+)", html))
        # 总行数：来自 章节表格。锁定行形式：[锁]
        locked_links = re.findall(r"onebook\.php\?novelid=%d&chapterid=\d+" % novelid, html)
        # 锁定章节：有一个 [锁] 文本的 row，无 chapterid 链接
        # 统计 "锁" 出现
        lock_cnt = html.count("锁")
        print(f"[{novelid}] 《{name}》 标题页: {title_m.group(1).strip() if title_m else '?'}")
        print(f"    免费chapterid数量: {len(free)}  含chapterid链接: {len(locked_links)}  词'锁'次数: {lock_cnt}")
        free_only = [c for c in free]
        print(f"    免费章节列表(前60): {sorted(map(int, free_only))[:60]}")
    except Exception as e:
        print(f"[{novelid}] 《{name}》 失败: {e}")
    print()
    time.sleep(0.5)