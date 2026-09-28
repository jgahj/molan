# -*- coding: utf-8 -*-
"""探测2：bqgui.cc 搜索表单 + SSL宽松重试其他站"""
import re
import time
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

# 1. bqgui.cc 首页找搜索表单
r = s.get('https://www.bqgui.cc', headers=UA, timeout=15)
forms = re.findall(r'<form[^>]*>.*?</form>', r.text, re.DOTALL)
for f in forms:
    if 'search' in f or 'sou' in f or '搜索' in f:
        print('表单:', f[:300])
        print('---')
# 也找 js 里的搜索跳转
js_search = re.findall(r'(?:action|url)[=:]\s*["\']([^"\']*(?:search|sou)[^"\']*)["\']', r.text)
print('JS搜索线索:', js_search[:5])

# 2. SSL 宽松重试
print('\n== SSL 宽松重试 ==')
for name, base in [('biquge5200.cc', 'https://www.biquge5200.cc'),
                   ('xbiquge.la', 'https://www.xbiquge.la'),
                   ('biqu5200.net', 'https://www.biqu5200.net')]:
    try:
        r = s.get(base, headers=UA, timeout=12, verify=False)
        print(f'{name}: {r.status_code}, {len(r.text)}字节')
    except Exception as e:
        print(f'{name}: {type(e).__name__} {str(e)[:50]}')
    time.sleep(1)
