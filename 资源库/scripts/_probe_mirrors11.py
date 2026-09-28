# -*- coding: utf-8 -*-
"""探测11：bqgui.cc 搜索结构分析"""
import re
import time
from urllib.parse import quote
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://www.bqgui.cc/'}
s = rq.Session(impersonate='chrome')

r = s.get('https://www.bqgui.cc/', headers=UA, timeout=15, verify=False)
print(f'首页: {r.status_code}, {r.encoding}, {len(r.text)}字节')

# 找表单和搜索 JS
forms = re.findall(r'<form[^>]*>[\s\S]*?</form>', r.text)
for f in forms:
    print('表单:', re.sub(r'\s+', ' ', f)[:300])
js = re.findall(r'["\']([^"\']*(?:search|sou|s\.php)[^"\']*)["\']', r.text)
print('JS搜索线索:', list(set(js))[:8])

# 常见端点
print('\n== 端点测试 ==')
q = quote('宜修换嫁')
for ep in [f'/search.php?q={q}', f'/s.php?q={q}', f'/search.html?key={q}',
           f'/modules/article/search.php?searchkey={q}', f'/web/search/{q}', f'/so.html?q={q}']:
    try:
        r = s.get(f'https://www.bqgui.cc{ep}', headers=UA, timeout=15, verify=False)
        print(f'{ep[:35]}: {r.status_code}, {len(r.text)}字节, 含书名:{"宜修换嫁" in r.text}')
    except Exception as e:
        print(f'{ep[:35]}: {type(e).__name__}')
    time.sleep(1)
