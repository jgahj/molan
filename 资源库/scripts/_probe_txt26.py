# -*- coding: utf-8 -*-
"""探测26：城通页面JS完整分析"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

url = 'https://url91.ctfile.com/f/37476991-1460132014-cbe30d?p=txtxiaoshuo'
r = s.get(url, headers=UA, timeout=20, verify=False)

# 提取所有 script 内联代码
scripts = re.findall(r'<script[^>]*>([\s\S]*?)</script>', r.text)
for i, sc in enumerate(scripts):
    sc = sc.strip()
    if len(sc) > 50:
        print(f'== script {i} ({len(sc)}字) ==')
        print(sc[:1500])
        print()

# body 结构
body = re.search(r'<body[\s\S]*?</body>', r.text)
if body:
    print('== body 片段 ==')
    print(re.sub(r'\s+', ' ', body.group(0))[:800])
