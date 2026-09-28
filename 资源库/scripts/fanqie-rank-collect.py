# -*- coding: utf-8 -*-
"""
番茄小说分类榜单批量采集脚本
功能：从番茄小说网页端抓取全部分类的畅销榜与新书榜书号（每榜前20本，共40本/分类），
     输出 fanqie-rank-manifest.json 供批量下载脚本消费。
采集方式：解析榜单页 SSR 数据（window.__INITIAL_STATE__.rank.book_list），
         通过 ?offset=10 翻页突破单页 10 本限制。
合规：请求间隔 >= 2 秒，UA 为真实浏览器 UA。
"""
import re
import json
import time
import sys
from curl_cffi import requests as rq

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
BASE = 'https://fanqienovel.com'
RANK_HOME = BASE + '/rank'
OUT_PATH = r'资源库\fanqie-rank-manifest.json'
DELAY_S = 2.0          # 请求间隔（秒）
PER_RANK = 20          # 每榜采集数量
PAGE_SIZE = 10         # 榜单页单页数量
# 榜单类型：1=畅销（阅读）榜，2=新书榜
RANK_TYPES = {'1': '畅销榜', '2': '新书榜'}


def sleep():
    """请求间隔休眠"""
    time.sleep(DELAY_S)


def fetch(url, session):
    """请求页面并返回文本，失败重试 3 次"""
    for attempt in range(3):
        try:
            r = session.get(url, headers=HEADERS, timeout=20, impersonate='chrome')
            if r.status_code == 200:
                return r.text
            print(f'  [warn] {url} 状态码 {r.status_code}，重试 {attempt + 1}')
        except Exception as e:
            print(f'  [warn] {url} 异常 {e!r}，重试 {attempt + 1}')
        time.sleep(3 * (attempt + 1))
    return None


def parse_state(html):
    """raw_decode 稳健解析 window.__INITIAL_STATE__"""
    m = re.search(r'window\.__INITIAL_STATE__\s*=\s*', html)
    if not m:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(html[m.end():])
        return obj
    except Exception:
        return None


def collect_categories(session):
    """从榜单主页解析全部分类（gender, categoryId, 分类名）"""
    html = fetch(RANK_HOME, session)
    if not html:
        raise RuntimeError('榜单主页获取失败')
    pairs = re.findall(r'<a[^>]+href="/rank/(\d)_(\d+)_(\d+)"[^>]*>([^<]{1,20})</a>', html)
    cats = {}
    for gender, _rt, cat_id, name in pairs:
        name = name.strip()
        if name:
            cats[(gender, cat_id)] = name
    return [{'gender': g, 'categoryId': c, 'name': n} for (g, c), n in sorted(cats.items())]


def collect_rank_books(session, gender, rank_type, cat_id):
    """抓取单分类单榜单的书籍（翻页至 PER_RANK 本）"""
    books = []
    seen = set()
    for offset in range(0, PER_RANK, PAGE_SIZE):
        url = f'{BASE}/rank/{gender}_{rank_type}_{cat_id}?offset={offset}'
        html = fetch(url, session)
        sleep()
        if not html:
            continue
        state = parse_state(html)
        if not state:
            print(f'  [warn] {url} 无初始状态')
            continue
        bl = (state.get('rank') or {}).get('book_list') or []
        for b in bl:
            bid = str(b.get('bookId') or '')
            if not bid or bid in seen:
                continue
            seen.add(bid)
            books.append({
                'bookId': bid,
                'rank': len(books) + 1,
                'readCount': b.get('readCount') or '',
                'wordNumber': b.get('wordNumber') or '',
                'creationStatus': b.get('creationStatus') or '',
            })
        if not bl:
            break
    return books


def main():
    """主流程：采集全部分类榜单并输出 manifest"""
    session = rq.Session(impersonate='chrome')
    print('== 采集分类列表 ==')
    cats = collect_categories(session)
    print(f'共 {len(cats)} 个分类:')
    for c in cats:
        print(f"  [{c["gender"]}] {c["name"]} (id={c["categoryId"]})")
    sleep()

    manifest = {
        'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'source': 'fanqienovel.com 分类榜单（畅销榜+新书榜 各前20）',
        'categories': [],
    }
    total_books = set()
    for c in cats:
        entry = {'gender': c['gender'], 'categoryId': c['categoryId'], 'name': c['name'], 'ranks': {}}
        for rt, rt_name in RANK_TYPES.items():
            books = collect_rank_books(session, c['gender'], rt, c['categoryId'])
            entry['ranks'][rt_name] = books
            for b in books:
                total_books.add(b['bookId'])
            print(f"[{c['name']}] {rt_name}: {len(books)} 本")
        manifest['categories'].append(entry)

    manifest['uniqueBookCount'] = len(total_books)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(f'\n== 完成 ==')
    print(f'分类数: {len(manifest["categories"])}  去重书号: {len(total_books)}')
    print(f'输出: {OUT_PATH}')


if __name__ == '__main__':
    main()
