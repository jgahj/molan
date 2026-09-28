# -*- coding: utf-8 -*-
"""探测6：主流聚合站（69书吧等）+ 番茄解封复查"""
import re
import time
from urllib.parse import quote
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

# 1. 番茄解封复查
try:
    r = s.get('https://fanqienovel.com/reader/7669342959321498136', headers=UA, timeout=20)
    ok = r.status_code == 200 and '__INITIAL_STATE__' in r.text and '验证码中间页' not in r.text
    print(f'番茄阅读页: {"解封!" if ok else "仍封禁"}')
except Exception as e:
    print(f'番茄阅读页: {type(e).__name__}')

# 2. 69书吧（books.qq.com 风格，支持搜索）
print('\n== 69shuba ==')
try:
    r = s.get('https://www.69shuba.com/', headers=UA, timeout=15, verify=False)
    print(f'首页: {r.status_code}, {len(r.text)}字节')
    r.encoding = 'gbk'
    # 搜索接口（69书吧已知路径 /modules/article/search.php POST 或 GET）
    q = quote('宜修换嫁')
    rs = s.get(f'https://www.69shuba.com/modules/article/search.php?searchkey={q}', headers=UA, timeout=15, verify=False)
    rs.encoding = 'gbk'
    has = '宜修换嫁' in rs.text
    print(f'搜索: {rs.status_code}, {len(rs.text)}字节, 含结果:{has}')
    if has:
        links = re.findall(r'<a[^>]*href="([^"]*(?:book|html)[^"]*)"[^>]*>([^<]*宜修[^<]*)</a>', rs.text)
        print('结果:', links[:3])
except Exception as e:
    print(f'{type(e).__name__}: {str(e)[:60]}')

# 3. 其他站
print('\n== 其他站 ==')
for name, base in [('trxs.cc', 'https://www.trxs.cc'),
                   ('jhxshu', 'https://www.jhxshu.com'),
                   ('biquges.cc', 'https://www.biquges.cc')]:
    try:
        r = s.get(base, headers=UA, timeout=12, verify=False)
        print(f'{name}: {r.status_code}, {len(r.text)}字节')
    except Exception as e:
        print(f'{name}: {type(e).__name__}')
    time.sleep(1)
