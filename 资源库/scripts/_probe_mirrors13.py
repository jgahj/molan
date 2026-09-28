# -*- coding: utf-8 -*-
"""探测13：biquges.cc 排行榜页面结构分析"""
import re
import time
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://www.biquges.cc/'}
s = rq.Session(impersonate='chrome')

# 1. 排行榜
r = s.get('https://www.biquges.cc/top/', headers=UA, timeout=15, verify=False)
print(f'排行页: {r.status_code}, {len(r.text)}字节')
# 提取榜单内书籍链接
books = re.findall(r'<a[^>]*href="(/\d+/\d+/)"[^>]*>([^<]+)</a>', r.text)
print(f'书籍链接数: {len(books)}')
for u, t in books[:15]:
    print(f'  {u} | {t.strip()[:40]}')
# 榜单类型 tab
tabs = re.findall(r'<a[^>]*href="(/top/[^"]*)"[^>]*>([^<]+)</a>', r.text)
print('榜单tab:', list(set(tabs))[:10])

# 2. 分类页结构
time.sleep(2)
r2 = s.get('https://www.biquges.cc/list1/', headers=UA, timeout=15, verify=False)
print(f'\n玄幻分类页: {r2.status_code}, {len(r2.text)}字节')
books2 = re.findall(r'<a[^>]*href="(/\d+/\d+/)"[^>]*>([^<]+)</a>', r2.text)
print(f'书籍链接数: {len(books2)}')
for u, t in books2[:10]:
    print(f'  {u} | {t.strip()[:40]}')
# 翻页与排序参数线索
pages = re.findall(r'href="(/list1/[^"]*)"', r2.text)
print('翻页/排序链接:', list(set(pages))[:10])
