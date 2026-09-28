# -*- coding: utf-8 -*-
"""
批量下载引擎：按 18 题材类型 + 热度(积分)优先，为每类型凑齐可用书并下载免费章节。
特性：全局限速 / 指数退避重试 / 空响应(限流)重试 / 断点续传 / 每类型分批。
用法：python _download_all.py [--types 玄幻,仙侠] [--per 20]
"""
import gzip
import json
import os
import random
import re
import ssl
import sys
import time
import urllib.request

# ---------- 网络 ----------
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
CACHED_COOKIE = "testcookie=yes; smidV2=202608252009511fbfaf43a6b46b38df03c8bedb1c41ce00e637a23b6f74bb0; JJEVER=%7B%22shumeideviceId%22%3A%22WHJMrwNw1k/EVuGXUmHfkIzIXWcssqukodQZxMWU2jelG7JcZ0/08DJw6EJLz4d4AYPcrbka4u/vXpds0hK8Bpoe5ZQOWaAcvdCW1tldyDzmQI99+chXEimae3WVKreby9lCUKKcsmkSqmJzoPeggwzYmmmXo8LlTkQE5YcNLqNriNYPfoOP/bjqNkCQ56lOWi2XQGU8B3VOESR7s+OEsxynovXXLjYfIJKaQLlUH5oDnJ6SIZnD9cQOqmR+wvvl8F10/rPYNoNw%3D1487582755342%22%7D"
BASE = "https://www.jjwxc.net/onebook.php?"

# 全局限速（秒）：相邻请求最小间隔 + 抖动；避免触发晋江限流
MIN_INT = 1.3
_last = {"t": 0.0}


def _throttle():
    now = time.time()
    gap = MIN_INT + random.uniform(-0.2, 0.3)
    sleep = gap - (now - _last["t"])
    if sleep > 0:
        time.sleep(sleep)
    _last["t"] = time.time()


def fetch(url, max_try=5):
    """带限速与重试的抓取；返回 (ok, html)"""
    for attempt in range(1, max_try + 1):
        _throttle()
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            "Referer": "https://www.jjwxc.net/",
            "Cookie": CACHED_COOKIE,
            "Accept-Encoding": "gzip, deflate",
        })
        try:
            with urllib.request.urlopen(req, timeout=30, context=CTX) as resp:
                raw = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            text = raw.decode("gb18030", errors="ignore")
            # 限流特征：空 body 或无 novelid/标题结构
            if len(raw) > 2000 and ("onebook.php" in text or "<title>" in text):
                return True, text
            # 可能是限流空页
            raise RuntimeError("疑似限流空页 len=%d" % len(raw))
        except Exception as e:
            back = min(30, 3 * (2 ** (attempt - 1)))
            print(f"    fetch重试{attempt}/{max_try}: {str(e)[:60]} (退避{back}s)")
            time.sleep(back)
    return False, ""


def extract_body(html):
    """提取章节正文"""
    m = re.search(r'id="paragraph_comment_content"[^>]*>(.*?)</div>', html, re.S)
    if m:
        seg = m.group(1)
        seg = re.sub(r"<br\s*/?>", "\n", seg)
        seg = re.sub(r"<[^>]+>", "", seg)
        return seg.replace("\xa0", " ").strip()
    return ""


def get_free_chapters(novelid):
    """返回免费章节 id 列表（目录页）"""
    ok, html = fetch(BASE + "novelid=%d" % novelid)
    if not ok:
        return None
    ids = sorted(set(int(x) for x in re.findall(r"chapterid=(\d+)", html)))
    return ids


def download_book(novelid, outdir):
    """下载一本书的全部免费章节，保存为单文件；返回写入字数或 None"""
    ids = get_free_chapters(novelid)
    if ids is None:
        return None
    if len(ids) < 4:
        return 0  # 免费章太少，不算可用
    fp = outdir
    if os.path.exists(fp):
        return os.path.getsize(fp)
    chunks = []
    failed = 0
    for ch in ids:
        ok, html = fetch(BASE + "novelid=%d&chapterid=%d" % (novelid, ch))
        if ok:
            body = extract_body(html)
            if len(body) >= 40:
                chunks.append(f"### 第{ch}章\n{body}")
            else:
                failed += 1
        else:
            failed += 1
    text = "\n\n".join(chunks)
    if len(text) < 100:
        return 0
    with open(fp, "w", encoding="utf-8") as f:
        f.write(text)
    return len(text)


def main():
    ROOT = os.path.dirname(os.path.abspath(__file__))
    out_root = os.path.join(ROOT, "raws2")
    os.makedirs(out_root, exist_ok=True)

    args = sys.argv[1:]
    only_types = None
    per = 20
    if "--types" in args:
        i = args.index("--types")
        only_types = [t.strip() for t in args[i + 1].split(",")]
    if "--per" in args:
        per = int(args[args.index("--per") + 1])

    with open(os.path.join(ROOT, "types_novels.json"), encoding="utf-8") as fh:
        pool = json.load(fh)

    print("== 冷却 120s 以免延续限流 ==")
    time.sleep(120)

    for tname, candidates in pool.items():
        if only_types and tname not in only_types:
            continue
        if not candidates:
            print(f"[{tname}] 无候选，跳过")
            continue
        tdir = os.path.join(out_root, tname)
        os.makedirs(tdir, exist_ok=True)
        saved = 0
        tried = 0
        print(f"== [{tname}] 目标 {per} 本，候选 {len(candidates)} ==")
        for cand in candidates:
            if saved >= per:
                break
            if tried >= 80:
                print(f"  [{tname}] 已尝试{80}本仍未凑够，停止该类型")
                break
            nid = cand["novelid"]
            title = cand["title"]
            tried += 1
            fp = os.path.join(tdir, f"{nid}.txt")
            size = download_book(nid, fp)
            if size and size > 0:
                saved += 1
                print(f"  [{tname}]({saved}/{per}) {nid}《{title}》 已保存 {size} 字节")
            elif size == 0:
                # 免费章不足或正文过少；若文件已建但内容少则删除
                if os.path.exists(fp) and os.path.getsize(fp) < 100:
                    try:
                        os.remove(fp)
                    except OSError:
                        pass
            else:
                # None = 限流重试失败，暂停该类型更久
                print(f"  [{tname}] {nid} 持续失败(限流)，暂停60s")
                time.sleep(60)
        print(f"[{tname}] 完成：{saved}/{per} 本")
    print("ALL DOWNLOAD DONE")


if __name__ == "__main__":
    main()