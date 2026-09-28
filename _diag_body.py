# -*- coding: utf-8 -*-
"""诊断晋江章节正文容器标签，用于优化提取"""
import gzip
import re
import ssl
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


def fetch_http(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=25, context=CTX) as resp:
        raw = resp.read()
    if resp.headers.get("Content-Encoding") == "gzip":
        raw = gzip.decompress(raw)
    return raw.decode("gb18030", errors="ignore")


html = fetch_http("https://www.jjwxc.net/onebook.php?novelid=370832&chapterid=10")
i = html.find("吃饭的时候")
print("正文起点索引:", i, "总长度:", len(html))
# 回溯找最近的完整标签起始
seg = html[max(0, i - 1500): i]
# 找最后一个 '<div' 
last_div = seg.rfind("<div")
print("正文前最近的开放标签片段:")
print(html[last_div:i + 200])
print("=" * 40)
# 列出所有含有 novel 的 class
allcls = re.findall(r'<div[^>]*class="([^"]*novel[^"]*)"', html)
print("含 novel 的 class 列表:", allcls[:20])