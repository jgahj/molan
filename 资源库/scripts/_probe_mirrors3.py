# -*- coding: utf-8 -*-
"""探测3：验证搜索接口 + 测试番茄书收录情况"""
import re
import time
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

# 从清单取几本真实书名测试
import json
m = json.load(open(r'资源库\fanqie-rank-manifest.json', encoding='utf-8'))
titles = []
for cat in m['categories'][:5]:
    for b in cat['ranks']['畅销榜'][:2]:
        titles.append(b.get('title') or '')
print('测试书名:', titles[:8])
print()

# 测试 xbiquge.la 搜索
for title in titles[:3]:
    if not title:
        continue
    # 常见搜索端点
    for endpoint in [f'https://www.xbiquge.la/search.php?q={title}',
                     f'https://www.xbiquge.la/s.php?q={title}']:
        try:
            r = s.get(endpoint, headers=UA, timeout=15, verify=False)
            has = title[:4] in r.text
            print(f'xbiquge {endpoint.split(".la")[1][:20]}: {r.status_code}, {len(r.text)}字节, 含书名:{has}')
            if has:
                # 提取搜索结果链接
                links = re.findall(r'<a[^>]*href="(/book/\d+/\d+/|/\d+_\d+/)[^"]*"[^>]*>([^<]*)</a>', r.text)
                print('  结果:', links[:3])
                break
        except Exception as e:
            print(f'xbiquge {endpoint.split(".la")[1][:20]}: {type(e).__name__}')
    time.sleep(1)
    print()

# 测试 biquge5200.cc 搜索
for title in titles[:3]:
    if not title:
        continue
    for endpoint in [f'https://www.biquge5200.cc/search.php?keyword={title}',
                     f'https://www.biquge5200.cc/modules/article/search.php?searchkey={title}']:
        try:
            r = s.get(endpoint, headers=UA, timeout=15, verify=False)
            has = title[:4] in r.text
            print(f'biquge5200 {endpoint.split(".cc")[1][:25]}: {r.status_code}, {len(r.text)}字节, 含书名:{has}')
            if has:
                links = re.findall(r'<a[^>]*href="([^"]*)"[^>]*>([^<]*)</a>', r.text)
                cands = [l for l in links if title[:4] in l[1]][:3]
                print('  结果:', cands)
                break
        except Exception as e:
            print(f'biquge5200: {type(e).__name__}')
    time.sleep(1)
    print()
