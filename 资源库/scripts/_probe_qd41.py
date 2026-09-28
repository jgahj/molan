# -*- coding: utf-8 -*-
"""探测41：shukuge /Search?wd= 验证"""
import re
from urllib.parse import quote
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'http://www.shukuge.com/'}
s = rq.Session(impersonate='chrome')

r = s.get('http://www.shukuge.com/Search?wd=' + quote('逆天邪神'), headers=UA, timeout=20, verify=False)
print('状态:', r.status_code, '大小:', len(r.text))
books = re.findall(r'href="(/book/\d+/)"', r.text)
print('书链数:', len(set(books)))
for b in list(dict.fromkeys(books))[:8]:
    print(' ', b)
idx = r.text.find('逆天')
if idx > 0:
    print('预览:', re.sub(r'\s+', ' ', r.text[max(0, idx - 300):idx + 400])[:500])
