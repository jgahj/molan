# -*- coding: utf-8 -*-
"""探测21：biquges.cc 整页阅读模式测试"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://www.biquges.cc/0/143/'}
s = rq.Session(impersonate='chrome')

# 常见整页模式路径
paths = [
    '/0/143/all.html', '/0/143/all/', '/0/143/full.html', '/0/143/whole.html',
    '/0/143/index_all.html', '/readall/0/143/', '/0/143/reader.html',
    '/txt/0/143/', '/0/143/down.html', '/0/143/download/',
]
for p in paths:
    try:
        r = s.get(f'https://www.biquges.cc{p}', headers=UA, timeout=12, verify=False)
        print(f'{p}: {r.status_code}, {len(r.text)}字节')
    except Exception as e:
        print(f'{p}: {type(e).__name__}')

# 检查详情页里的全部功能链接（下拉菜单、按钮）
r = s.get('https://www.biquges.cc/0/143/', headers=UA, timeout=15, verify=False)
# 所有非章节链接
links = set(re.findall(r'href="(/[^"]*)"', r.text))
non_chap = [l for l in links if not re.match(r'^/\d+/\d+/\d+\.html$', l)]
print('\n非章节链接:')
for l in sorted(non_chap)[:30]:
    print(' ', l)
# JS 功能函数
funcs = re.findall(r'function\s+(\w+)', r.text)
print('JS函数:', funcs[:15])
