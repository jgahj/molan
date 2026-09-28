# -*- coding: utf-8 -*-
"""探测5：分析镜像站首页搜索表单真实结构"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

for name, base in [('xbiquge.la', 'https://www.xbiquge.la'),
                   ('biquge5200.cc', 'https://www.biquge5200.cc'),
                   ('bqgui.cc', 'https://www.bqgui.cc')]:
    r = s.get(base, headers=UA, timeout=15, verify=False)
    print(f'== {name} ==')
    # 表单
    forms = re.findall(r'<form[^>]*>[\s\S]*?</form>', r.text)
    for f in forms:
        print('表单:', re.sub(r'\s+', ' ', f)[:200])
    # 搜索相关 JS
    for pat in [r'(?:action|post|get)\(["\']([^"\']*search[^"\']*)["\']',
                r'url[:\s]+["\']([^"\']*(?:search|s\.php|sou)[^"\']*)["\']',
                r'/(?:api|json|ajax)[^"\'\s]*search[^"\'\s]*']:
        for m in re.findall(pat, r.text):
            print('JS线索:', m)
    print()
