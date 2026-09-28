# -*- coding: utf-8 -*-
"""探测39：搜索 JS 逻辑挖掘"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

r = s.get('http://www.shukuge.com/', headers=UA, timeout=20, verify=False)

# 1. input 周边上下文
idx = r.text.find('placeholder="作者/小说名"')
print('== 搜索框上下文 ==')
print(re.sub(r'\s+', ' ', r.text[max(0, idx - 300):idx + 300]))
print()

# 2. search 相关 JS
for m in re.finditer(r'function\s+search[\s\S]{0,500}?\}', r.text):
    print('搜索函数:', m.group(0)[:500])
# 搜索点击事件
for m in re.finditer(r'(?:\.search|search\(\)|#search)[\s\S]{0,300}', r.text):
    t = m.group(0)[:300]
    if 'click' in t or 'submit' in t or 'location' in t or 'href' in t:
        print('事件:', t)
        print('---')
