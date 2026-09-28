# -*- coding: utf-8 -*-
"""
番茄小说批量下载脚本（并行安全版）
功能：读取 fanqie-rank-manifest.json，多线程并行下载全部书籍正文，
     分类交错调度（所有分类同时推进），按分类存入 "资源库\\小说原本\\{分类名}"。
     支持断点续传、验证码挑战识别与全局退避、坏书自动重试。
接口：书籍页 https://fanqienovel.com/page/{book_id}（SSR 解析章节列表），
     阅读页 https://fanqienovel.com/reader/{chapter_id}（SSR 提取正文并解码 PUA 字符）。
解码：正文约半数字符为 PUA 区（U+E3F8..U+E55B）自定义编码，
     复用 fanqienovel-downloader 的 charset 映射表（mode 0）还原明文。
风控经验：约 5 请求/秒的并行负载会在 10 分钟内触发验证码封禁；
     安全速率约 1 请求/秒（3 线程 × 1.5-2.5 秒间隔）。
用法：python fanqie-batch-download.py [--workers 3] [--max-chapters 0]
"""
import os
import re
import json
import time
import random
import argparse
import threading
import sys
from queue import Queue
from curl_cffi import requests as rq
from lxml import etree

BASE = 'https://fanqienovel.com'
ROOT = r'c:\Users\lyh\Desktop\小说专属网页\资源库'
DOWNLOADER_SRC = os.path.join(ROOT, 'tools', 'fanqienovel-downloader', 'src', 'ref_main.py')
MANIFEST_PATH = os.path.join(ROOT, 'fanqie-rank-manifest.json')
PROGRESS_PATH = os.path.join(ROOT, 'scripts', 'fanqie-download-progress.json')
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
BOOK_DELAY = (2.0, 3.0)      # 书籍页请求间隔（秒）
CHAP_DELAY = (1.0, 1.8)      # 阅读页请求间隔（秒）——单线程安全值
MAX_RETRY = 3
CHALLENGE_RETRY = 5          # 验证码挑战页最大重试次数
CHALLENGE_PAUSE = 300        # 检测到挑战页后的全局暂停秒数
MAX_EMPTY_ATTEMPTS = 3       # mostly_empty 书最大重试轮数（超过则放弃，视为 VIP 书）
# PUA 解码表：从 ref_main.py 提取（CODE mode 0: 58344..58715）
PUA_LO, PUA_HI = 58344, 58715
CHARSET = None
# 章节获取结果哨兵值
CHALLENGE = '__CHALLENGE__'  # 遇到验证码挑战页

# 线程共享状态
print_lock = threading.Lock()
progress_lock = threading.Lock()
stats_lock = threading.Lock()
pause_lock = threading.Lock()
pause_until = [0.0]          # 全局退避截止时间戳（挑战页/403/429 触发）


def flush_print(msg):
    """线程安全输出并立即刷新"""
    with print_lock:
        print(msg)
        sys.stdout.flush()


def trigger_global_pause(seconds):
    """触发全局退避：所有工作线程暂停指定秒数"""
    with pause_lock:
        pause_until[0] = max(pause_until[0], time.time() + seconds)
    flush_print(f'[backoff] 触发风控退避 {seconds} 秒')


def respect_global_pause():
    """请求前等待全局退避结束（若处于退避期）"""
    while True:
        with pause_lock:
            until = pause_until[0]
        now = time.time()
        if now >= until:
            return
        time.sleep(min(5, until - now))


def load_progress():
    """加载下载进度文件（bookId -> 状态），支持断点续传"""
    if os.path.exists(PROGRESS_PATH):
        try:
            with open(PROGRESS_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_progress(progress):
    """持久化下载进度（调用方须持有 progress_lock）"""
    tmp = PROGRESS_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(progress, f, ensure_ascii=False, indent=1)
    os.replace(tmp, PROGRESS_PATH)


def load_charset():
    """从 fanqienovel-downloader 源码提取 PUA 字符映射表（mode 0），线程启动前调用"""
    global CHARSET
    if CHARSET is not None:
        return CHARSET
    with open(DOWNLOADER_SRC, 'r', encoding='utf-8') as f:
        src = f.read()
    m = re.search(r"charset = json\.loads\(\s*'(.*?)'\s*\)", src, re.DOTALL)
    if not m:
        raise RuntimeError('无法从 ref_main.py 提取 charset 映射表')
    CHARSET = json.loads(m.group(1))[0]
    return CHARSET


def decode_pua(text):
    """将 PUA 区自定义编码字符还原为明文"""
    table = load_charset()
    out = []
    for ch in text:
        uni = ord(ch)
        bias = uni - PUA_LO
        if 0 <= bias < len(table) and table[bias] not in ('?', ''):
            out.append(table[bias])
        else:
            out.append(ch)
    return ''.join(out)


def is_challenge_page(html):
    """判断是否为验证码挑战页（字节跳动风控中间页）"""
    return '__INITIAL_STATE__' not in html or '验证码中间页' in html


def get_with_retry(session, url):
    """带重试与风控退避的 GET 请求，返回 Response 或 None"""
    for attempt in range(MAX_RETRY):
        respect_global_pause()
        try:
            r = session.get(url, headers=HEADERS, timeout=25, impersonate='chrome')
            if r.status_code == 200:
                return r
            if r.status_code in (403, 429):
                trigger_global_pause(120 + 60 * attempt)
                continue
            flush_print(f'  [warn] {url} 状态码 {r.status_code}，重试 {attempt + 1}')
        except Exception as e:
            flush_print(f'  [warn] {url} 异常 {e!r}，重试 {attempt + 1}')
        time.sleep(3 * (attempt + 1))
    return None


def sanitize_filename(name):
    """替换文件名非法字符"""
    illegal = ['<', '>', ':', '"', '/', '\\', '|', '?', '*']
    rep = ['＜', '＞', '：', '＂', '／', '＼', '｜', '？', '＊']
    for a, b in zip(illegal, rep):
        name = name.replace(a, b)
    return name.strip()[:120]


def parse_book_page(html):
    """解析书籍页：返回 (书名, 作者, 简介, 章节列表 [(标题, 章节ID)]) 或 None"""
    ele = etree.HTML(html)
    title_nodes = ele.xpath('//h1/text()')
    if not title_nodes:
        return None
    title = title_nodes[0].strip()
    author = ''
    author_nodes = ele.xpath('//div[contains(@class,"author-name")]//span[contains(@class,"author-name-text")]/text()')
    if author_nodes:
        author = author_nodes[0].strip()
    desc = ''
    desc_nodes = ele.xpath('//div[contains(@class,"page-abstract-content")]//p/text()')
    if desc_nodes:
        desc = desc_nodes[0].strip()
    chapters = []
    for a in ele.xpath('//div[@class="chapter"]/div/a'):
        href = a.xpath('@href')
        text = a.text
        if href and text:
            chapters.append((text, href[0].split('/')[-1]))
    return title, author, desc, chapters


def fetch_chapter_content(session, chapter_id):
    """从官方阅读页 SSR 提取正文。
    返回值：正文文本（成功）；''（VIP 锁章，有状态但无内容）；CHALLENGE（验证码页，需中止）。"""
    url = f'{BASE}/reader/{chapter_id}'
    for attempt in range(CHALLENGE_RETRY):
        respect_global_pause()
        try:
            r = session.get(url, headers=HEADERS, timeout=25, impersonate='chrome')
            if r.status_code == 200:
                if is_challenge_page(r.text):
                    # 验证码挑战页：全局退避后重试
                    trigger_global_pause(CHALLENGE_PAUSE)
                    flush_print(f'  [challenge] 章节 {chapter_id} 命中验证码，第 {attempt + 1}/{CHALLENGE_RETRY} 次退避重试')
                    continue
                m = re.search(r'window\.__INITIAL_STATE__\s*=\s*', r.text)
                if not m:
                    trigger_global_pause(60)
                    continue
                obj, _ = json.JSONDecoder().raw_decode(r.text[m.end():])
                cd = ((obj.get('reader') or {}).get('chapterData')) or {}
                content = cd.get('content') or ''
                if not content:
                    # 有初始状态但无内容：VIP 锁章
                    return ''
                content = re.sub(r'<header>.*?</header>', '', content, flags=re.DOTALL)
                content = re.sub(r'<footer>.*?</footer>', '', content, flags=re.DOTALL)
                content = re.sub(r'</?article>', '', content)
                content = re.sub(r'<p[^>]*>', '\n', content)
                content = re.sub(r'</p>', '\n', content)
                content = re.sub(r'<[^>]+>', '', content)
                content = decode_pua(content)
                content = re.sub(r'\n{3,}', '\n\n', content).strip()
                return content
            if r.status_code in (403, 429):
                trigger_global_pause(120 + 60 * attempt)
                continue
            flush_print(f'  [warn] 章节 {chapter_id} 状态码 {r.status_code}，重试 {attempt + 1}')
        except Exception as e:
            flush_print(f'  [warn] 章节 {chapter_id} 异常 {e!r}，重试 {attempt + 1}')
        time.sleep(3 * (attempt + 1))
    # 多次退避后仍是挑战页：返回哨兵值，让上层中止本书
    return CHALLENGE


def download_book(session, book_id, cat_dir, max_chapters, tag):
    """下载单本书全部章节并保存为单个 txt，返回 (状态, 书名)。
    状态：ok / exists / fail / no_chapters / mostly_empty / throttled"""
    r = get_with_retry(session, f'{BASE}/page/{book_id}')
    time.sleep(random.uniform(*BOOK_DELAY))
    if not r:
        return 'fail', ''
    if is_challenge_page(r.text):
        trigger_global_pause(CHALLENGE_PAUSE)
        return 'throttled', ''
    parsed = parse_book_page(r.text)
    if not parsed:
        return 'fail', ''
    title, author, desc, chapters = parsed
    if not chapters:
        return 'no_chapters', title
    total = len(chapters)
    if max_chapters > 0:
        chapters = chapters[:max_chapters]
    flush_print(f'{tag}《{title}》 {len(chapters)}/{total} 章，作者: {author or "未知"}')

    safe_name = sanitize_filename(title)
    out_path = os.path.join(cat_dir, safe_name + '.txt')

    parts = [f'小说名：{title}\n作者：{author}\n内容简介：{desc}\n']
    empty_count = 0
    for idx, (chap_title, chap_id) in enumerate(chapters, 1):
        content = fetch_chapter_content(session, chap_id)
        if content == CHALLENGE:
            # 中止本书（不写盘），交给守护进程稍后重试
            flush_print(f'{tag}  《{title}》因风控中止，稍后重试')
            return 'throttled', title
        if not content:
            empty_count += 1
        parts.append('\n' + chap_title + '\n' + content + '\n')
        if idx % 50 == 0:
            flush_print(f'{tag}  《{title}》进度 {idx}/{len(chapters)}')
        time.sleep(random.uniform(*CHAP_DELAY))

    # 全部章节获取后再一次性写盘，避免半成品文件
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(''.join(parts))
    if empty_count > len(chapters) * 0.5:
        return 'mostly_empty', title
    return 'ok', title


def build_tasks(manifest, category_filter=None):
    """构建分类交错的下载任务队列：轮转取书，保证所有分类同时推进"""
    by_cat = []
    for cat in manifest.get('categories', []):
        if category_filter and cat['name'] not in category_filter:
            continue
        items = []
        seen = set()
        for rank_name in ('畅销榜', '新书榜'):
            for book in cat.get('ranks', {}).get(rank_name, []):
                bid = str(book.get('bookId') or '')
                if not bid or bid in seen:
                    continue
                seen.add(bid)
                items.append((cat['name'], rank_name, book))
        by_cat.append(items)
    tasks = []
    max_len = max((len(x) for x in by_cat), default=0)
    for i in range(max_len):
        for items in by_cat:
            if i < len(items):
                tasks.append(items[i])
    return tasks, len(by_cat)


def remove_existing_file(cat_dir, title):
    """删除已存在的书文件（重试坏书时清掉旧文件）"""
    import glob as _glob
    for f in _glob.glob(os.path.join(cat_dir, title[:60] + '*')):
        try:
            os.remove(f)
        except OSError:
            pass


def worker(worker_id, task_q, progress, stats, target_root, max_chapters):
    """工作线程主循环：从队列取书下载，逐书更新进度"""
    session = rq.Session(impersonate='chrome')
    tag = f'[W{worker_id}]'
    while True:
        try:
            cat_name, rank_name, book = task_q.get_nowait()
        except Exception:
            break
        bid = str(book.get('bookId') or '')
        cat_dir = os.path.join(target_root, cat_name)
        os.makedirs(cat_dir, exist_ok=True)
        with progress_lock:
            prev = progress.get(bid, {})
            prev_status = prev.get('status')
            attempts = prev.get('attempts', 0)
            # 跳过条件：已完成，或 mostly_empty 重试超限（视为 VIP 书放弃）
            if prev_status == 'ok' or (prev_status == 'mostly_empty' and attempts >= MAX_EMPTY_ATTEMPTS):
                task_q.task_done()
                continue
            if prev_status == 'mostly_empty' and prev.get('title'):
                # 重试坏书前删除旧文件
                remove_existing_file(cat_dir, prev['title'])
        flush_print(f'{tag}[{cat_name}|{rank_name} #{book.get("rank")}] 书号 {bid}')
        try:
            status, title = download_book(session, bid, cat_dir, max_chapters, tag)
        except Exception as e:
            flush_print(f'{tag} [error] 书号 {bid} 下载异常: {e!r}')
            status, title = 'fail', ''
        with progress_lock:
            attempts = progress.get(bid, {}).get('attempts', 0) + 1 if status == 'mostly_empty' else attempts
            progress[bid] = {
                'status': status,
                'title': title,
                'category': cat_name,
                'rank': rank_name,
                'attempts': attempts,
                'at': time.strftime('%Y-%m-%d %H:%M:%S'),
            }
            save_progress(progress)
        with stats_lock:
            stats[status] = stats.get(status, 0) + 1
            done = sum(v for k, v in stats.items() if k != 'skip')
            if done % 10 == 0:
                flush_print(f'{tag} == 累计完成 {done} 本，统计: {stats} ==')
        task_q.task_done()
    session.close()


def main():
    """主流程：解析参数 → 读 manifest → 交错队列 → 多线程并行下载"""
    parser = argparse.ArgumentParser(description='番茄小说并行批量下载（安全速率版）')
    parser.add_argument('--workers', type=int, default=3, help='并行线程数（默认 3，过高会触发风控）')
    parser.add_argument('--max-chapters', type=int, default=0, help='每本书章节上限（0=不限制）')
    parser.add_argument('--categories', type=str, default='', help='只下载指定分类，逗号分隔')
    args = parser.parse_args()

    if not os.path.exists(MANIFEST_PATH):
        flush_print(f'找不到清单文件: {MANIFEST_PATH}，请先运行 fanqie-rank-collect.py')
        sys.exit(1)
    with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    category_filter = set(filter(None, args.categories.split(','))) if args.categories else None
    tasks, cat_count = build_tasks(manifest, category_filter)
    if not tasks:
        flush_print('没有可下载的任务')
        sys.exit(0)

    load_charset()
    progress = load_progress()
    already = sum(1 for c, r, b in tasks
                  if progress.get(str(b.get('bookId') or ''), {}).get('status') == 'ok')
    flush_print(f'任务总数: {len(tasks)} 本，覆盖 {cat_count} 个分类，已完成跳过: {already} 本')
    flush_print(f'并行线程: {args.workers}，章节间隔: {CHAP_DELAY} 秒，章节上限: {args.max_chapters or "不限"}')

    task_q = Queue()
    for t in tasks:
        task_q.put(t)
    stats = {'ok': 0, 'exists': 0, 'fail': 0, 'no_chapters': 0, 'mostly_empty': 0, 'throttled': 0, 'skip': already}
    target_root = os.path.join(ROOT, '小说原本')
    os.makedirs(target_root, exist_ok=True)

    threads = []
    for i in range(args.workers):
        t = threading.Thread(target=worker, args=(i + 1, task_q, progress, stats, target_root, args.max_chapters), daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()

    flush_print('\n== 本轮完成 ==')
    flush_print(f'统计: {stats}')
    flush_print(f'输出目录: {target_root}')


if __name__ == '__main__':
    main()
