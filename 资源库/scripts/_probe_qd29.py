# -*- coding: utf-8 -*-
"""探测29：shukuge 下载页结构"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'http://www.shukuge.com/book/61386/'}
s = rq.Session(impersonate='chrome')

r = s.get('http://www.shukuge.com/download/61386/', headers=UA, timeout=20, verify=False)
print(f'下载页: {r.status_code}, {len(r.text)}字节')
t = re.search(r'<title>([^<]*)</title>', r.text)
print('标题:', t.group(1) if t else '?')
print('Content-Type:', r.headers.get('content-type'))

# 看是文件还是网页
is_txt = not r.headers.get('content-type', '').startswith('text/html')
if is_txt:
    print('直接是文件！前300字:', r.text[:300])
else:
    # 找真实下载链接
    for pat in [r'<a[^>]*href="([^"]*)"[^>]*>([^<]*(?:下载|download)[^<]*)</a>',
                r'href="([^"]*\.(?:txt|zip|rar)[^"]*)"']:
        for m in re.findall(pat, r.text, re.I)[:10]:
            print('下载链接:', m)
    # JS 跳转
    js = re.findall(r'(?:location\.href|window\.location)\s*=\s*["\']([^"\']+)', r.text)
    print('JS跳转:', js[:5])
    # 显示正文区域
    body = re.sub(r'\s+', ' ', r.text)
    idx = body.find('下载')
    if idx > 0:
        print('上下文:', body[max(0, idx - 200):idx + 500])
