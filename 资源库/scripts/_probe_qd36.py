# -*- coding: utf-8 -*-
"""探测36：所有榜单类型 + 女频分类"""
import re
from curl_cffi import requests as rq

UA_M = {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'}
s = rq.Session(impersonate='chrome')

# 1. rank 首页所有榜单类型
r = s.get('https://m.qidian.com/rank/', headers=UA_M, timeout=20, verify=False)
print('== 男频榜单类型 ==')
tabs = re.findall(r'href="(/rank/\w+/[^"]*)"[^>]*>([^<]{2,10})</a>', r.text)
for u, t in dict.fromkeys(tabs):
    if 'catid' not in u and 'yuepiao' not in u:
        print(f'  {u} | {t}')
# 也找纯榜单名
types = re.findall(r'href="/rank/(\w+)/"', r.text)
print('榜单类型代码:', list(dict.fromkeys(types)))

# 2. 畅销榜测试
print('\n== 畅销榜(hotsales) ==')
r2 = s.get('https://m.qidian.com/rank/hotsales/', headers=UA_M, timeout=20, verify=False)
books = re.findall(r'href="//m\.qidian\.com/book/(\d+)/"[^>]*title="([^"]+?)最新章节', r2.text)
print(f'畅销榜: {r2.status_code}, {len(books)}本')
for bid, t in books[:5]:
    print(f'  {bid} | {t}')

# 3. 新书榜测试（newbook / newsign）
print('\n== 新书榜单测试 ==')
for rk in ['newbook', 'newsign', 'new']:
    try:
        r3 = s.get(f'https://m.qidian.com/rank/{rk}/', headers=UA_M, timeout=20, verify=False)
        books3 = re.findall(r'href="//m\.qidian\.com/book/(\d+)/"[^>]*title="([^"]+?)最新章节', r3.text)
        print(f'{rk}: {r3.status_code}, {len(books3)}本' + (f' 首: {books3[0][1]}' if books3 else ''))
    except Exception as e:
        print(f'{rk}: {type(e).__name__}')

# 4. 女频
print('\n== 女频(qdmm) ==')
try:
    r4 = s.get('https://m.qdmm.com/rank/', headers=UA_M, timeout=20, verify=False)
    print(f'女频rank: {r4.status_code}, {len(r4.text)}字节')
    types4 = re.findall(r'href="/rank/(\w+)/"', r4.text)
    print('女频榜单类型:', list(dict.fromkeys(types4))[:10])
    cats4 = re.findall(r'href="(/rank/\w+/catid[\w-]*/[^"]*)"[^>]*>([^<]{2,10})</a>', r4.text)
    for u, t in dict.fromkeys(cats4):
        if 'catid' in u:
            print(f'  {u} | {t}')
except Exception as e:
    print(f'女频: {type(e).__name__} {str(e)[:50]}')
