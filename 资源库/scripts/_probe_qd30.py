# -*- coding: utf-8 -*-
"""探测30：下载页真实按钮与接口"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'http://www.shukuge.com/download/61386/'}
s = rq.Session(impersonate='chrome')

r = s.get('http://www.shukuge.com/download/61386/', headers=UA, timeout=20, verify=False)
text = r.text

# 所有链接
links = re.findall(r'<a[^>]*href="([^"]+)"[^>]*>([^<]*)</a>', text)
print('所有链接:')
for u, t in links:
    if not any(k in u for k in ['css', 'js', 'ico']):
        print(f'  {u[:70]} | {t.strip()[:30]}')

# 所有 script 内联
scripts = re.findall(r'<script[^>]*>([\s\S]*?)</script>', text)
for i, sc in enumerate(scripts):
    sc = sc.strip()
    if len(sc) > 30 and 'src=' not in sc[:50]:
        print(f'\n== script {i} ==')
        print(sc[:800])

# form 表单
forms = re.findall(r'<form[\s\S]*?</form>', text)
for f in forms:
    print('\n表单:', re.sub(r'\s+', ' ', f)[:400])

# onclick 按钮
clicks = re.findall(r'onclick="([^"]*)"', text)
print('\nonclick:', clicks[:8])
