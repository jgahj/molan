# -*- coding: utf-8 -*-
"""探测31：shukuge 搜索接口 + 起点榜单重试"""
import re
import time
from urllib.parse import quote
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

# 1. shukuge 搜索
print('== shukuge 搜索 ==')
r0 = s.get('http://www.shukuge.com/', headers=UA, timeout=20, verify=False)
forms = re.findall(r'<form[^>]*>', r0.text)
print('首页表单:', forms[:3])

# 常见搜索端点
for ep in [f'/search.php?q={quote("逆天邪神")}', f'/s.php?q={quote("逆天邪神")}',
           f'/search.html?q={quote("逆天邪神")}', f'/so.php?s={quote("逆天邪神")}',
           f'/search/?q={quote("逆天邪神")}', f'/index.php?m=search&q={quote("逆天邪神")}']:
    try:
        r = s.get(f'http://www.shukuge.com{ep}', headers=UA, timeout=15, verify=False)
        has = '逆天邪神' in r.text and ('/book/' in r.text)
        print(f'{ep[:30]}: {r.status_code}, {len(r.text)}字节, 有效:{has}')
        if has and r.status_code == 200 and len(r.text) > 3000:
            books = re.findall(r'<a[^>]*href="(/book/\d+/)"[^>]*>([^<]*逆天邪神[^<]*)</a>', r.text)
            print('  结果:', books[:3])
            break
    except Exception as e:
        print(f'{ep[:30]}: {type(e).__name__}')
    time.sleep(1)

# 2. 起点重试（带完整浏览器头）
print('\n== 起点重试 ==')
s2 = rq.Session(impersonate='chrome')
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
}
for url in ['https://www.qidian.com/rank/yuepiao/', 'https://www.qidian.com/all/',
            'https://m.qidian.com/rank/', 'https://www.qidian.com/rank/hotsales/']:
    try:
        r = s2.get(url, headers=headers, timeout=20, verify=False)
        print(f'{url}: {r.status_code}, {len(r.text)}字节')
    except Exception as e:
        print(f'{url}: {type(e).__name__}')
    time.sleep(1.5)
