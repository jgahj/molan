# -*- coding: utf-8 -*-
"""验证测试：单分类单榜单 3 本书走完整链路"""
import sys
sys.path.insert(0, r'c:\Users\lyh\Desktop\小说专属网页\资源库\scripts')
from qidian_shukuge_pipeline import *
import os, re

# 只测玄幻畅销榜前3本
print('== 测试: 起点玄幻畅销榜 ==')
r = sess_qd.get('https://m.qidian.com/rank/hotsales/catid21/', headers=UA_M, timeout=25, verify=False)
books = parse_rank_page(r.text)[:3]
print(f'榜单: {len(books)}本')
for b in books:
    print(f"  {b['id']} | {b['title']} | {b['author']}")

print('\n== 测试: shukuge 搜索+下载 ==')
os.makedirs(os.path.join(OUT_DIR, '测试'), exist_ok=True)
for b in books:
    title, author = b['title'], b['author']
    print(f'\n《{title}》{author}:')
    entries = search_shukuge(title)
    print(f'  搜索结果: {len(entries)}条')
    for e in entries[:3]:
        print(f'    {e[0]} | {e[1]} | {e[2]} | {e[3]}')
    hit = match_book(entries, title, author)
    if not hit:
        print('  ✗ 未匹配')
        continue
    print(f'  ✓ 匹配: {hit[0]} {hit[1]} {hit[2]}')
    zip_bytes, err = download_book_zip(hit[0])
    if zip_bytes is None:
        print(f'  ✗ 下载失败: {err}')
        continue
    out = os.path.join(OUT_DIR, '测试', re.sub(r'[\\/:*?"<>|]', '_', f'{title}.txt'))
    ok = extract_txt(zip_bytes, out)
    if ok:
        size = os.path.getsize(out)
        with open(out, encoding='utf-8') as f:
            head = f.read(120).replace('\n', ' ')
        print(f'  ✓ 下载解压成功 {size//1024}KB')
        print(f'  开头: {head[:100]}')
    else:
        print('  ✗ 解压失败')
    time.sleep(2)
