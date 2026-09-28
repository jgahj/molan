# -*- coding: utf-8 -*-
"""探测19：biquges.cc 整本下载入口"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://www.biquges.cc/0/143/'}
s = rq.Session(impersonate='chrome')

r = s.get('https://www.biquges.cc/0/143/', headers=UA, timeout=15, verify=False)
print(f'详情页: {r.status_code}, {len(r.text)}字节')

# 找下载相关链接/按钮
for pat in [r'<a[^>]*href="([^"]*(?:txt|zip|rar|download|down)[^"]*)"[^>]*>([^<]*)</a>',
            r'href="([^"]*\.txt[^"]*)"',
            r'(?:download|下载|打包|导出)[^<]{0,30}']:
    for m in re.findall(pat, r.text, re.I)[:10]:
        print('命中:', m)

# 常见下载路径直测
print('\n== 直测下载路径 ==')
for path in ['/txt/0_143.html', '/down/143.html', '/txt/143.html', '/0/143.txt',
             '/modules/article/txtlist.php?id=143', '/txt.php?id=0/143',
             '/export/0/143/', '/txtfull/0/143/']:
    try:
        r2 = s.get(f'https://www.biquges.cc{path}', headers=UA, timeout=12, verify=False)
        print(f'{path}: {r2.status_code}, {len(r2.text)}字节, 类型:{r2.headers.get("content-type", "?")}')
    except Exception as e:
        print(f'{path}: {type(e).__name__}')
