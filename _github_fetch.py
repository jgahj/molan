# -*- coding: utf-8 -*-
"""从 GitHub raw 批量下载小说 txt，避免晋江分页限流。支持断点续传与限量。"""
import json
import os
import ssl
import sys
import urllib.parse
import urllib.request

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Encoding": "identity",
}

REPO = "DJDQfff/NetliteratureCollection"
BRANCH = "main"
TREE_JSON = "nl_tree.json"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "books", REPO)


def download(path, outfile, tries=8):
    url = "https://raw.githubusercontent.com/%s/%s/%s" % (
        REPO, BRANCH, urllib.parse.quote(path))
    for i in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers=H)
            with urllib.request.urlopen(req, timeout=180, context=CTX) as resp:
                data = resp.read()
            with open(outfile, "wb") as f:
                f.write(data)
            return len(data)
        except Exception as e:
            if "10054" in str(e).lower() or "handshake" in str(e).lower() or "timeout" in str(e).lower():
                wait = min(40, 3 * i)
                print(f"    retry{i}: {str(e)[:50]} 等待{wait}s")
                import time as _t
                _t.sleep(wait)
            else:
                raise
    raise RuntimeError("下载多次重试仍失败")


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(TREE_JSON, encoding="utf-8") as fh:
        tree = json.load(fh)
    paths = [t["path"] for t in tree.get("tree", []) if t["path"].lower().endswith(".txt")]
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    done, fail = 0, 0
    for i, p in enumerate(paths):
        if limit and i >= limit:
            break
        outfile = os.path.join(OUT, os.path.basename(p))
        if os.path.exists(outfile) and os.path.getsize(outfile) > 0:
            done += 1
            continue
        try:
            n = download(p, outfile)
            print(f"  [{i+1}/{len(paths)}] {p} -> {n//1024}KB")
            done += 1
        except Exception as e:
            print(f"  [{i+1}] {p} 失败: {str(e)[:60]}")
            fail += 1
    print(f"DONE: 成功/已存在 {done}, 失败 {fail}")


if __name__ == "__main__":
    main()