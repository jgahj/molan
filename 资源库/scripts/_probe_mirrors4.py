# -*- coding: utf-8 -*-
"""探测4：用已知书名测试镜像站搜索（书名来自已下载的27本）"""
import re
import time
from urllib.parse import quote
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

# 已知书名（进度文件中）
titles = ['宜修换嫁年羹尧，摆烂躺赢了', '穿成依萍，我带雪姨制霸上海滩', 'HP：菲林斯在霍格沃兹']

print('== xbiquge.la ==')
for title in titles:
    q = quote(title[:6])  # 用书名前6字搜索
    try:
        r = s.get(f'https://www.xbiquge.la/search.php?q={q}', headers=UA, timeout=15, verify=False)
        has = title[:3] in r.text
        print(f'《{title}》: {r.status_code}, {len(r.text)}字节, 含结果:{has}')
        if has:
            # 提取搜索结果
            links = re.findall(r'<a[^>]*href="([^"]+)"[^>]*>\s*([^<]{2,30})\s*</a>', r.text)
            cands = [l for l in links if title[:3] in l[1]][:3]
            print('  匹配链接:', cands)
    except Exception as e:
        print(f'《{title}》: {type(e).__name__} {str(e)[:50]}')
    time.sleep(1)

print('\n== biquge5200.cc ==')
for title in titles:
    q = quote(title[:6])
    try:
        r = s.get(f'https://www.biquge5200.cc/search.php?keyword={q}', headers=UA, timeout=15, verify=False)
        has = title[:3] in r.text
        print(f'《{title}》: {r.status_code}, {len(r.text)}字节, 含结果:{has}')
        if has:
            links = re.findall(r'<a[^>]*href="([^"]+)"[^>]*title="([^"]*)"', r.text)
            cands = [l for l in links if title[:3] in l[1]][:3]
            print('  匹配链接:', cands)
    except Exception as e:
        print(f'《{title}》: {type(e).__name__} {str(e)[:50]}')
    time.sleep(1)
