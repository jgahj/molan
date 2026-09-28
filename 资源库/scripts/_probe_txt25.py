# -*- coding: utf-8 -*-
"""探测25：城通网盘下载链接解析"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

url = 'https://url91.ctfile.com/f/37476991-1460132014-cbe30d?p=txtxiaoshuo'
r = s.get(url, headers=UA, timeout=20, verify=False)
print(f'页面: {r.status_code}, {len(r.text)}字节')
print('标题:', re.search(r'<title>([^<]*)</title>', r.text).group(1) if re.search(r'<title>([^<]*)</title>', r.text) else '?')

# 找直链线索
for pat in [r'(https?://[^"\']*\.ctfile\.com/[a-z]+/[^"\']{10,80})',
            r'(?:file_url|down_url|dlink|filelink)\s*[:=]\s*["\']([^"\']+)',
            r'href="([^"]*(?:download|getfile|speed)[^"]*)"']:
    for m in re.findall(pat, r.text)[:8]:
        print('链接线索:', m[:100])

# JS 变量
for pat in [r'var\s+(\w+)\s*=\s*["\']([^"\']{5,80})["\'];']:
    for k, v in re.findall(pat, r.text)[:15]:
        print(f'JS变量 {k} = {v[:80]}')
