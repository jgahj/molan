# -*- coding: utf-8 -*-
"""晋江免费完本小说批量下载器：按 novelid 抓取全部免费章节正文并保存为文本"""
import gzip
import os
import re
import ssl
import time
from html.parser import HTMLParser

import urllib.request

# 本机 msys python 证书未配置，关闭 SSL 校验
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

BASE = "https://www.jjwxc.net/onebook.php"


def fetch(url):
    """抓取并解码页面 HTML"""
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=25, context=CTX) as resp:
        raw = resp.read()
    if resp.headers.get("Content-Encoding") == "gzip":
        raw = gzip.decompress(raw)
    return raw.decode("gb18030", errors="ignore")


class BodyExtractor(HTMLParser):
    """递归提取 class 含 noveltext 的 div 内全部文本（按文档顺序）"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.depth = 0
        self.in_body = False
        self.body_depth = 0
        self.capturing = False

    def handle_starttag(self, tag, attrs):
        cls = dict(attrs).get("class", "")
        if tag == "div" and "noveltext" in cls and not self.capturing:
            self.capturing = True
            self.body_depth = self.depth
        if self.capturing:
            self.depth += 1
            if tag == "br":
                self.parts.append("\n")

    def handle_endtag(self, tag):
        if self.capturing:
            self.depth -= 1
            if self.depth <= self.body_depth:
                self.capturing = False

    def handle_data(self, data):
        if self.capturing:
            self.parts.append(data)

    def get_text(self):
        return "".join(self.parts).replace("\xa0", " ")


def extract_body(html):
    """提取章节正文：优先取 id=paragraph_comment_content 容器（每段以 <br> 分隔）"""
    m = re.search(r'id="paragraph_comment_content"[^>]*>(.*?)</div>', html, re.S)
    if m:
        seg = m.group(1)
        seg = re.sub(r"<br\s*/?>", "\n", seg)
        seg = re.sub(r"<[^>]+>", "", seg)
        seg = seg.replace("\xa0", " ").strip()
        return seg
    # 兜底：按 noveltext 容器提取
    p = BodyExtractor()
    try:
        p.feed(html)
    except Exception:
        pass
    return p.get_text().replace("\xa0", " ").strip()


def get_free_chapters(novelid):
    """从目录页解析免费章节 id 列表"""
    html = fetch(f"{BASE}?novelid={novelid}")
    ids = sorted(set(int(x) for x in re.findall(r"chapterid=(\d+)", html)))
    return ids, html


def download_book(novelid, name, out_dir):
    """下载一本书的全部免费章节"""
    out_dir = os.path.join(out_dir, f"{novelid}_{name}")
    os.makedirs(out_dir, exist_ok=True)
    ids, _ = get_free_chapters(novelid)
    print(f"[{name}] 共 {len(ids)} 个免费章节")
    ok = 0
    for ch in ids:
        fp = os.path.join(out_dir, f"{ch:03d}.txt")
        try:
            html = fetch(f"{BASE}?novelid={novelid}&chapterid={ch}")
            body = extract_body(html)
            if len(body) >= 50:
                with open(fp, "w", encoding="utf-8") as f:
                    f.write(body)
                ok += 1
            else:
                print(f"  章{ch} 正文过短：{len(body)}")
        except Exception as e:
            print(f"  章{ch} 失败: {e}")
        time.sleep(0.35)
    print(f"[{name}] 成功保存 {ok}/{len(ids)} 章到 {out_dir}")


if __name__ == "__main__":
    ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raws")
    os.makedirs(ROOT, exist_ok=True)
    BOOKS = {
        2456: "何以笙箫默",
        370832: "微微一笑很倾城",
        247098: "杉杉来吃",
        3429203: "你是我的荣耀",
        931329: "知否知否应是绿肥红瘦",
    }
    for nid, nm in BOOKS.items():
        download_book(nid, nm, ROOT)
        time.sleep(0.5)
    print("ALL DONE")