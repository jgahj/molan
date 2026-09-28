# -*- coding: utf-8 -*-
"""探测32：m.qidian.com 榜单结构 + shukuge /search/ 分析"""
import re
import time
from urllib.parse import quote
from curl_cffi import requests as rq

UA_M = {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'}
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

# 1. m.qidian.com 榜单
print('== m.qidian.com/rank/ ==')
r = s.get('https://m.qidian.com/rank/', headers=UA_M, timeout=20, verify=False)
# 找榜单 tab 链接
tabs = re.findall(r'<a[^>]*href="([^"]*)"[^>]*>([^<]{2,12})</a>', r.text)
uniq = []
seen = set()
for u, t in tabs:
    k = (u, t.strip())
    if k not in seen and ('rank' in u or '榜' in t):
        seen.add(k)
        uniq.append(k)
for u, t in uniq[:30]:
    print(f'  {u} | {t}')

# 2. 榜单内页测试
time.sleep(1.5)
print('\n== 月票榜内页 ==')
r2 = s.get('https://m.qidian.com/rank/yuepiao/', headers=UA_M, timeout=20, verify=False)
print(f'内页: {r2.status_code}, {len(r2.text)}字节')
# 书籍条目（移动端一般是 /book/1047156675 形式链接）
books = re.findall(r'href="(/book/\d+)"[^>]*>\s*(?:<[^>]*>)*([^<]{2,40})', r2.text)
print('书籍数:', len(books))
for u, t in books[:8]:
    print(f'  {u} | {t.strip()}')

# 3. shukuge /search/ 看返回内容
print('\n== shukuge /search/ ==')
r3 = s.get(f'http://www.shukuge.com/search/?q={quote("逆天邪神")}', headers=UA, timeout=15, verify=False)
print(f'状态: {r3.status_code}, {len(r3.text)}字节')
body = re.sub(r'\s+', ' ', r3.text)
# 搜索结果区域
print('body 预览:', body[1500:2500])
