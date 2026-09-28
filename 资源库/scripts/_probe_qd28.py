# -*- coding: utf-8 -*-
"""探测28：起点榜单页 + shukuge.com 结构"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

# 1. 起点榜单（月票榜/畅销榜）
print('== 起点排行榜 ==')
try:
    r = s.get('https://www.qidian.com/rank/', headers=UA, timeout=20, verify=False)
    print(f'排行首页: {r.status_code}, {len(r.text)}字节')
    tabs = re.findall(r'href="(/rank/[^"]*)"[^>]*>([^<]+)</a>', r.text)
    uniq = list(dict.fromkeys([(u, t.strip()) for u, t in tabs]))
    for u, t in uniq[:25]:
        print(f'  {u} | {t}')
except Exception as e:
    print(f'起点: {type(e).__name__} {str(e)[:60]}')

# 2. shukuge.com
print('\n== shukuge.com ==')
try:
    r2 = s.get('http://www.shukuge.com/book/61386/', headers=UA, timeout=20, verify=False)
    print(f'示例书页: {r2.status_code}, {r2.encoding}, {len(r2.text)}字节')
    t = re.search(r'<title>([^<]*)</title>', r2.text)
    print('标题:', t.group(1) if t else '?')
    # 下载入口
    for pat in [r'<a[^>]*href="([^"]*(?:txt|zip|rar|down|pack|export)[^"]*)"[^>]*>([^<]{0,30})</a>']:
        for m in re.findall(pat, r2.text, re.I)[:10]:
            print('下载线索:', m)
    # 搜索入口
    forms = re.findall(r'<form[^>]*>', r2.text)
    print('表单:', forms[:3])
except Exception as e:
    print(f'shukuge: {type(e).__name__} {str(e)[:60]}')
