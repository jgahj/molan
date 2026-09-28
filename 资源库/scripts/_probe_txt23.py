# -*- coding: utf-8 -*-
"""探测23：txtxiaoshuo.com 站点结构与下载功能"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

# 1. 用户给的示例页
r = s.get('https://txtxiaoshuo.com/?id=30733', headers=UA, timeout=20, verify=False)
print(f'示例页: {r.status_code}, {r.encoding}, {len(r.text)}字节')
print('标题:', re.search(r'<title>([^<]*)</title>', r.text).group(1) if re.search(r'<title>([^<]*)</title>', r.text) else '?')

# 找下载按钮
for pat in [r'<a[^>]*href="([^"]*(?:txt|zip|rar|down|pack)[^"]*)"[^>]*>([^<]{0,30})</a>',
            r'<button[^>]*onclick="([^"]*)"[^>]*>([^<]{0,20})</button>',
            r'(?:下载|打包|导出|download)[^<]{0,20}']:
    for m in re.findall(pat, r.text, re.I)[:10]:
        print('下载线索:', m)

# 2. 首页结构
r2 = s.get('https://txtxiaoshuo.com/', headers=UA, timeout=20, verify=False)
print(f'\n首页: {r2.status_code}, {len(r2.text)}字节')
# 分类/榜单链接
cats = re.findall(r'<a[^>]*href="([^"]*)"[^>]*>([^<]{2,12})</a>', r2.text)
interesting = [(u, t.strip()) for u, t in cats if any(k in u for k in ['sort', 'class', 'top', 'rank', 'list', 'cate', '?'])][:30]
print('功能链接:')
for u, t in interesting:
    print(f'  {u} | {t}')
