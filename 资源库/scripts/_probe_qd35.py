# -*- coding: utf-8 -*-
"""探测35：完整条目解析 + 分类参数 + 新书榜"""
import re
from curl_cffi import requests as rq

UA_M = {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'}
s = rq.Session(impersonate='chrome')

r = s.get('https://m.qidian.com/rank/yuepiao/', headers=UA_M, timeout=20, verify=False)

# 1. 完整条目块（含作者）
idx = r.text.find('捞尸人')
block = r.text[idx:idx + 1500]
print('== 条目完整块 ==')
print(block[:1200])

# 2. 页面里的分类选项
print('\n== 分类选项 ==')
cats = re.findall(r'href="(/rank/yuepiao/[^"]*)"[^>]*>([^<]{2,10})</a>', r.text)
for u, t in dict.fromkeys(cats):
    if 'catid' in u:
        print(f'  {u} | {t}')
