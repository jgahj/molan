# -*- coding: utf-8 -*-
"""探测7：biquges.cc 搜索测试"""
import re
import time
from urllib.parse import quote
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://www.biquges.cc/'}
s = rq.Session(impersonate='chrome')

r = s.get('https://www.biquges.cc/', headers=UA, timeout=15, verify=False)
print(f'首页: {r.status_code}, 编码: {r.encoding}, {len(r.text)}字节')

# 找搜索表单
forms = re.findall(r'<form[^>]*>[\s\S]*?</form>', r.text)
print('表单数:', len(forms))
for f in forms:
    print('表单:', re.sub(r'\s+', ' ', f)[:250])
    print()

# 常见搜索端点逐一测试
print('== 搜索端点测试 ==')
for title in ['宜修换嫁', '斗破苍穹']:
    q = quote(title)
    for ep in [f'/search.php?q={q}', f'/s.php?q={q}', f'/search.html?keyword={q}',
               f'/modules/article/search.php?searchkey={q}', f'/so/{q}/']:
        try:
            r = s.get(f'https://www.biquges.cc{ep}', headers=UA, timeout=12, verify=False)
            has = title in r.text
            if r.status_code != 404 or has:
                print(f'{ep[:40]}: {r.status_code}, {len(r.text)}字节, 含"{title}":{has}')
        except Exception as e:
            print(f'{ep[:40]}: {type(e).__name__}')
        time.sleep(0.5)
    print()
