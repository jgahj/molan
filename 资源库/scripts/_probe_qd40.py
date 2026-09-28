# -*- coding: utf-8 -*-
"""探测40：外部JS搜索逻辑"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

r = s.get('http://www.shukuge.com/', headers=UA, timeout=20, verify=False)
srcs = re.findall(r'<script[^>]*src="([^"]+)"', r.text)
print('JS文件:', srcs)

for src in srcs:
    if 'jquery' in src or 'bootstrap' in src:
        continue
    try:
        url = src if src.startswith('http') else f'http://www.shukuge.com{src}'
        rj = s.get(url, headers=UA, timeout=15, verify=False)
        # 找 search 逻辑
        for m in re.finditer(r'search[\s\S]{0,200}', rj.text, re.I):
            t = m.group(0)
            if 'click' in t or 'location' in t or 'window' in t or 'url' in t.lower():
                print(f'\n[{src}]')
                print(t[:250])
                break
        # 按回车/按钮提交
        for m in re.finditer(r'(?:keydown|keypress|click)[\s\S]{0,150}', rj.text):
            t = m.group(0)
            if 'search' in t.lower() or 'input' in t.lower():
                print(f'\n[{src} 事件]')
                print(t[:200])
    except Exception as e:
        print(f'{src}: {type(e).__name__}')
