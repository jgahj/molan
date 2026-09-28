# -*- coding: utf-8 -*-
"""探测33：m.qidian.com 数据提取方式分析"""
import re
import json
from curl_cffi import requests as rq

UA_M = {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'}
s = rq.Session(impersonate='chrome')

r = s.get('https://m.qidian.com/rank/yuepiao/', headers=UA_M, timeout=20, verify=False)
print(f'页面: {r.status_code}, {len(r.text)}字节')

# 1. 找内嵌 JSON（g_data 变量是起点通用模式）
m = re.search(r'var\s+g_data\s*=\s*(\{[\s\S]*?\});\s*</script>', r.text)
if m:
    print('找到 g_data!')
    print(m.group(1)[:500])

# 2. __INITIAL_STATE__
m2 = re.search(r'window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});', r.text)
if m2:
    print('找到 __INITIAL_STATE__!')
    print(m2.group(1)[:500])

# 3. body 里的书籍链接（各种形式）
for pat in [r'href="//m\.qidian\.com/book/(\d+)"', r'href="/book/(\d+)"', r'bid[=:]["\'](\d+)']:
    ids = re.findall(pat, r.text)
    if ids:
        print(f'模式 {pat[:30]}: {len(ids)}个: {ids[:5]}')

# 4. 所有 script src（找数据接口）
srcs = re.findall(r'<script[^>]*src="([^"]+)"', r.text)
for u in srcs[:10]:
    print('script:', u[:80])

# 5. body 文本找书名特征（书名+作者模式）
names = re.findall(r'<h[24][^>]*>([^<]{2,25})</h[24]>', r.text)
print('h2/h4标题:', names[:15])
