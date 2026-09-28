# -*- coding: utf-8 -*-
"""探测12：biquges.cc 分类目录与榜单结构"""
import re
import time
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://www.biquges.cc/'}
s = rq.Session(impersonate='chrome')

r = s.get('https://www.biquges.cc/', headers=UA, timeout=15, verify=False)
print(f'首页: {r.status_code}, {len(r.text)}字节')

# 找分类链接（sort/class/quanben 等常见路径）
links = re.findall(r'<a[^>]*href="([^"]+)"[^>]*>([^<]{2,10})</a>', r.text)
cats = [(u, t.strip()) for u, t in links if re.search(r'/(?:sort|class|sort|top|rank|quanben|categories?)', u)]
print('分类链接:')
for u, t in cats[:40]:
    print(f'  {u} | {t}')

# 看看首页导航完整结构
nav = re.findall(r'<nav[\s\S]*?</nav>|<div class="nav[\s\S]*?</div>', r.text)
for n in nav[:2]:
    print('\n导航区:')
    for u, t in re.findall(r'<a[^>]*href="([^"]+)"[^>]*>([^<]+)</a>', n):
        print(f'  {u} | {t.strip()}')
