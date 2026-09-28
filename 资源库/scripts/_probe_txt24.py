# -*- coding: utf-8 -*-
"""探测24：txtxiaoshuo 下载按钮机制 + 分类列表结构"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

# 1. 书籍页完整解析
r = s.get('https://txtxiaoshuo.com/?id=30733', headers=UA, timeout=20, verify=False)
# 找“下载TXT”按钮的完整上下文
idx = r.text.find('下载TXT')
print('== 下载TXT 上下文 ==')
print(re.sub(r'\s+', ' ', r.text[max(0, idx - 400):idx + 200]))
print()

# 密码提示上下文
idx2 = r.text.find('密码')
if idx2 > 0:
    print('== 密码上下文 ==')
    print(re.sub(r'\s+', ' ', r.text[max(0, idx2 - 200):idx2 + 300]))

# 2. 分类页列表结构
print('\n== 分类页(cate=2 玄幻) ==')
r2 = s.get('https://txtxiaoshuo.com/?cate=2', headers=UA, timeout=20, verify=False)
books = re.findall(r'<a[^>]*href="https://txtxiaoshuo\.com/\?id=(\d+)"[^>]*>([^<]+)</a>', r2.text)
uniq = list(dict.fromkeys(books))
print(f'书籍数: {len(uniq)}')
for bid, t in uniq[:10]:
    print(f'  ?id={bid} | {t.strip()[:40]}')
# 翻页
pages = re.findall(r'href="([^"]*page[^"]*)"', r2.text)
print('翻页:', list(set(pages))[:8])
