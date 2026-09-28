# -*- coding: utf-8 -*-
"""
起点榜单 → shukuge.com 下载流水线
阶段1: 抓取起点移动端榜单（畅销榜+新书榜，14个分类）
阶段2: 在 shukuge 搜索书名，匹配作者拿 book id
阶段3: 下载整本 ZIP，解压 TXT 存入目标目录
"""
import os
import re
import io
import json
import time
import zipfile
from urllib.parse import quote, unquote
from curl_cffi import requests as rq

# ============ 配置 ============
BASE_DIR = r'c:\Users\lyh\Desktop\小说专属网页\资源库'
OUT_DIR = os.path.join(BASE_DIR, '小说原本')          # 小说存储目录
MANIFEST = os.path.join(BASE_DIR, 'qidian-rank-manifest.json')  # 阶段1书单
PROGRESS = os.path.join(BASE_DIR, 'shukuge-download-progress.json')  # 下载进度

UA_PC = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
UA_M = {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'}

# 起点男频 14 个分类（catid → 名称）
QD_CATS = [
    ('21', '玄幻'), ('1', '奇幻'), ('2', '武侠'), ('22', '仙侠'), ('4', '都市'),
    ('15', '现实'), ('6', '军事'), ('5', '历史'), ('7', '游戏'), ('8', '体育'),
    ('9', '科幻'), ('10', '悬疑灵异'), ('20109', '诸天无限'), ('12', '轻小说'),
]
RANKS = [('hotsales', '畅销榜'), ('newbook', '新书榜')]
PER_RANK = 20  # 每榜单本数

sess_qd = rq.Session(impersonate='chrome')
sess_sk = rq.Session(impersonate='chrome')


def load_json(path, default):
    """加载 JSON 文件，不存在返回默认值"""
    if os.path.exists(path):
        try:
            with open(path, encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return default


def save_json(path, data):
    """保存 JSON 文件"""
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


# ============ 阶段1：起点榜单采集 ============
def parse_rank_page(html):
    """解析起点移动端榜单页，返回 [{id,title,author,category}]"""
    books = []
    # 条目锚点: <a href="//m.qidian.com/book/{id}/" title="{书名}最新章节在线阅读"
    pat = re.compile(
        r'href="//m\.qidian\.com/book/(\d+)/"[^>]*title="([^"]+?)最新章节在线阅读".*?'
        r'<h2[^>]*title="[^"]*">([^<]+)</h2>.*?<p class="_subTitle[^"]*">([^<]+?)<em',
        re.DOTALL)
    for bid, _t, title, sub in pat.findall(html):
        # sub = "作者 · 分类 · 字数"
        parts = [p.strip() for p in sub.split('·')]
        author = parts[0] if parts else ''
        books.append({'id': bid, 'title': title.strip(), 'author': author})
    # 去重（同书可能重复出现）
    seen, uniq = set(), []
    for b in books:
        if b['id'] not in seen:
            seen.add(b['id'])
            uniq.append(b)
    return uniq


def collect_qidian_ranks():
    """采集起点 14 分类 × 2 榜单的书籍清单"""
    manifest = {'source': 'm.qidian.com', 'collectedAt': time.strftime('%Y-%m-%d %H:%M:%S'), 'categories': []}
    total = 0
    for cid, cname in QD_CATS:
        cat_data = {'catId': cid, 'name': cname, 'ranks': {}}
        for rk, rk_name in RANKS:
            url = f'https://m.qidian.com/rank/{rk}/catid{cid}/'
            books = []
            for attempt in range(3):
                try:
                    r = sess_qd.get(url, headers=UA_M, timeout=25, verify=False)
                    if r.status_code == 200:
                        books = parse_rank_page(r.text)
                        if books:
                            break
                except Exception:
                    pass
                time.sleep(3)
            books = books[:PER_RANK]
            for i, b in enumerate(books):
                b['rank'] = i + 1
            cat_data['ranks'][rk_name] = books
            total += len(books)
            print(f'  {cname}-{rk_name}: {len(books)}本' + (' [重试失败]' if not books else ''))
            time.sleep(1.2)
        manifest['categories'].append(cat_data)
        save_json(MANIFEST, manifest)  # 每分类保存一次，防中断丢失
    print(f'\n阶段1完成: {total} 本入清单 → {MANIFEST}')
    return manifest


# ============ 阶段2+3：shukuge 搜索匹配并下载 ============
def search_shukuge(title):
    """在 shukuge 搜索书名，返回 [(book_id, st_title, author, category)]"""
    try:
        r = sess_sk.get('http://www.shukuge.com/Search?wd=' + quote(title),
                        headers={**UA_PC, 'Referer': 'http://www.shukuge.com/'}, timeout=20, verify=False)
        if r.status_code != 200:
            return []
        # 结果条目: <a href="/book/{id}/" title="{书名}txt全集下载"><h2>书名</h2></a>
        #           <p class="sp"><span>作者：xx</span><span>分类：xx</span>...
        pat = re.compile(
            r'href="(/book/(\d+)/)"[^>]*title="([^"]*?)txt全集下载">\s*<h2>([^<]+)</h2>\s*</a>\s*'
            r'<p class="sp"><span>作者：([^<]*)</span><span>分类：([^<]*)</span>',
            re.DOTALL)
        return [(bid, h2.strip(), au.strip(), cat.strip())
                for _u, bid, _t, h2, au, cat in pat.findall(r.text)]
    except Exception:
        return []


def match_book(entries, title, author):
    """从搜索结果中匹配目标书：书名优先精确匹配，作者辅助校验"""
    if not entries:
        return None
    # 1. 书名+作者双精确
    for e in entries:
        if e[1] == title and e[2] == author:
            return e
    # 2. 书名精确
    for e in entries:
        if e[1] == title:
            return e
    # 3. 书名包含（起点书名可能带标点差异）
    for e in entries:
        if title[:6] in e[1] or e[1][:6] in title:
            return e
    return None


def download_book_zip(book_id, max_retry=4):
    """下载 shukuge 整本 ZIP（带 429 限流退避重试），返回 (zip_bytes, ext) 或 (None, err)"""
    headers = {**UA_PC, 'Referer': f'http://www.shukuge.com/download/{book_id}/'}
    for attempt in range(max_retry):
        # 中转页拿真实 ZIP 地址
        try:
            r = sess_sk.get(f'http://www.shukuge.com/downLoadfile/{book_id}/', headers=headers, timeout=25, verify=False)
            m = re.search(r'url=(http://download\.shukuge\.com/[^"\']+)', r.text)
            if not m:
                return None, '中转页无链接'
            zip_url = m.group(1).replace('&amp;', '&')
            rz = sess_sk.get(zip_url, headers={**UA_PC, 'Referer': f'http://www.shukuge.com/downLoadfile/{book_id}/'},
                             timeout=120, verify=False)
            if rz.status_code == 200 and rz.content[:2] == b'PK':
                return rz.content, '.zip'
            if rz.status_code == 429:
                wait = 45 * (attempt + 1)  # 退避: 45s/90s/135s
                print(f'      429限流，等待{wait}秒后重试({attempt + 1}/{max_retry})...')
                time.sleep(wait)
                continue
            return None, f'ZIP下载失败 {rz.status_code}'
        except Exception as e:
            if attempt < max_retry - 1:
                time.sleep(10)
                continue
            return None, f'{type(e).__name__}'
    return None, '429重试耗尽'


def extract_txt(zip_bytes, out_path):
    """从 ZIP 提取最大 TXT 并保存"""
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
        txts = [n for n in zf.namelist() if n.lower().endswith('.txt')]
        if not txts:
            return False
        # 取最大的 txt
        best = max(txts, key=lambda n: zf.getinfo(n).file_size)
        raw = zf.read(best)
        # 编码检测：GBK 常见，尝试 utf-8 失败则 gbk
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError:
            text = raw.decode('gbk', errors='replace')
        if len(text) < 5000:  # 内容过短视为坏文件
            return False
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(text)
        return True
    except Exception:
        return False


def run_pipeline():
    """主流程：书单采集 + 搜索匹配下载"""
    os.makedirs(OUT_DIR, exist_ok=True)

    # 阶段1：起点书单（已有则复用）
    if os.path.exists(MANIFEST):
        manifest = load_json(MANIFEST, None)
        print(f'[阶段1] 复用已有书单: {MANIFEST}')
    else:
        print('[阶段1] 采集起点榜单...')
        manifest = collect_qidian_ranks()

    # 阶段2+3：逐本搜索下载
    progress = load_json(PROGRESS, {'done': {}, 'failed': {}, 'skipped': {}})
    done, failed = progress['done'], progress['failed']

    # 展平任务列表
    tasks = []
    for cat in manifest['categories']:
        for rk_name, books in cat['ranks'].items():
            for b in books:
                tasks.append((cat['name'], rk_name, b))
    print(f'[阶段2] 共 {len(tasks)} 本待处理，已完成 {len(done)}，失败 {len(failed)}\n')

    stats = {'ok': 0, 'miss': 0, 'fail': 0}
    for i, (cname, rk_name, b) in enumerate(tasks):
        title, author, bid_qd = b['title'], b.get('author', ''), b['id']
        key = f'{title}|{author}'
        if key in done:
            continue
        cat_dir = os.path.join(OUT_DIR, cname)
        safe = re.sub(r'[\\/:*?"<>|]', '_', f'{title} - {author}.txt')
        out_path = os.path.join(cat_dir, safe)
        if os.path.exists(out_path):  # 文件已存在跳过
            done[key] = out_path
            continue

        # 搜索匹配
        entries = search_shukuge(title)
        time.sleep(1.5)  # 搜索限速
        hit = match_book(entries, title, author)
        if not hit:
            stats['miss'] += 1
            failed[key] = {'reason': 'shukuge无此书', 'cat': cname, 'rank': rk_name}
            print(f'[{i+1}/{len(tasks)}] 《{title}》未找到')
            continue

        sk_id = hit[0]
        # 下载并解压
        zip_bytes, err = download_book_zip(sk_id)
        time.sleep(8)  # 下载限速（防 429）
        if zip_bytes is None:
            stats['fail'] += 1
            failed[key] = {'reason': f'下载失败:{err}', 'cat': cname, 'rank': rk_name}
            print(f'[{i+1}/{len(tasks)}] 《{title}》下载失败: {err}')
            continue

        os.makedirs(cat_dir, exist_ok=True)
        if extract_txt(zip_bytes, out_path):
            size = os.path.getsize(out_path)
            stats['ok'] += 1
            done[key] = out_path
            failed.pop(key, None)
            print(f'[{i+1}/{len(tasks)}] 《{title}》{author} ✓ {size//1024}KB → {cname}/')
        else:
            stats['fail'] += 1
            failed[key] = {'reason': 'ZIP内无有效TXT', 'cat': cname, 'rank': rk_name}
            print(f'[{i+1}/{len(tasks)}] 《{title}》ZIP无有效TXT')

        # 定期保存进度
        if (i + 1) % 10 == 0:
            save_json(PROGRESS, progress)

    save_json(PROGRESS, progress)
    print(f'\n完成: 成功{stats["ok"]} 未收录{stats["miss"]} 失败{stats["fail"]}')
    print(f'小说目录: {OUT_DIR}')


if __name__ == '__main__':
    run_pipeline()
