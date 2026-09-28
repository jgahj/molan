# -*- coding: utf-8 -*-
"""探测17：真实章节页 + 目录分页"""
import re
import time
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://www.biquges.cc/0/143/'}
s = rq.Session(impersonate='chrome')

# 1. 目录第1页 + 第2页
for page in ['', 'index_2.html', 'index_3.html']:
    url = f'https://www.biquges.cc/0/143/{page}'
    r = s.get(url, headers=UA, timeout=15, verify=False)
    chaps = re.findall(r'href="(/0/143/(\d+)\.html)"[^>]*>([^<]+)</a>', r.text)
    uniq = list(dict.fromkeys([(u, t.strip()) for u, _, t in chaps]))
    print(f'目录[{page or "第1页"}]: {len(uniq)}章 | 首: {uniq[0][1][:20] if uniq else "-"} | 末: {uniq[-1][1][:20] if uniq else "-"}')
    time.sleep(1.5)

# 2. 真实第一章（从目录取最后一个链接）
r = s.get('https://www.biquges.cc/0/143/', headers=UA, timeout=15, verify=False)
chaps = re.findall(r'href="(/0/143/(\d+)\.html)"[^>]*>([^<]+)</a>', r.text)
uniq = list(dict.fromkeys([(u, t.strip()) for u, _, t in chaps]))
first_chap = uniq[-1]  # 倒序最后一个 = 第一章
print(f'\n第一章: {first_chap[0]} | {first_chap[1]}')

r2 = s.get(f'https://www.biquges.cc{first_chap[0]}', headers=UA, timeout=15, verify=False)
print(f'章节页: {r2.status_code}, {len(r2.text)}字节')

# 3. 找正文（所有 div 块文本量排序）
blocks = re.split(r'(<div[^>]*>)', r2.text)
results = []
for i in range(1, len(blocks), 2):
    tag = blocks[i]
    content = blocks[i + 1] if i + 1 < len(blocks) else ''
    text_len = len(re.sub(r'<[^>]+>|\s', '', content))
    results.append((text_len, tag[:60]))
results.sort(reverse=True)
for tl, tag in results[:3]:
    print(f'  块 {tag} => {tl}字')

# 最大块的正文预览
best_tag, best_content = None, None
best_len = 0
for i in range(1, len(blocks), 2):
    content = blocks[i + 1] if i + 1 < len(blocks) else ''
    text_len = len(re.sub(r'<[^>]+>|\s', '', content))
    if text_len > best_len and 'footer' not in blocks[i]:
        best_len, best_tag, best_content = text_len, blocks[i], content
text = re.sub(r'<br\s*/?>', '\n', best_content[:8000])
text = re.sub(r'<[^>]+>', '', text).strip()
print(f'\n正文容器: {best_tag[:80]}')
print('正文预览:', text[:300])
