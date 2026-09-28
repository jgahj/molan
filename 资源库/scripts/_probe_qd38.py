# -*- coding: utf-8 -*-
"""探测38：shukuge 搜索机制"""
import re
from urllib.parse import quote
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

r = s.get('http://www.shukuge.com/', headers=UA, timeout=20, verify=False)

# 搜索相关的所有元素
print('== 搜索相关 ==')
for pat in [r'<input[^>]*>', r'<form[\s\S]{0,300}?>', r'action="([^"]*)"',
            r'(?:search|sousou|sou)[^"\'>]{0,50}']:
    for m in re.findall(pat, r.text, re.I)[:8]:
        print(' ', str(m)[:120])

# script 里的搜索函数
scripts = re.findall(r'<script[^>]*>([\s\S]*?)</script>', r.text)
for sc in scripts:
    if 'search' in sc.lower() or 'sou' in sc.lower():
        print('\n搜索JS:')
        print(sc[:600])

# 尝试 GET 参数变体
print('\n== 参数变体 ==')
for ep in ['/search/?keyword=', '/search/?s=', '/search/?q=', '/search.php?keyword=',
           '/so/?q=', '/search/?searchkey=']:
    try:
        r2 = s.get(f'http://www.shukuge.com{ep}{quote("逆天邪神")}', headers=UA, timeout=15, verify=False)
        # 有效结果 = 页面包含指向书页的链接且不是首页壳
        books = re.findall(r'href="(/book/\d+/)"[^>]*>([^<]*逆天[^<]*)<', r2.text)
        is_home = 'topNav' in r2.text and len(r2.text) < 8000
        print(f'{ep}: {r2.status_code}, {len(r2.text)}字节, 匹配:{len(books)}')
        if books:
            print('  结果:', books[:3])
            break
    except Exception as e:
        print(f'{ep}: {type(e).__name__}')
