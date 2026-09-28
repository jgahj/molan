# -*- coding: utf-8 -*-
"""探测14：验证榜单分类参数 + 书籍详情页/章节页结构"""
import re
import time
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://www.biquges.cc/'}
s = rq.Session(impersonate='chrome')

# 1. 各分类总榜第1页（确认分类参数与每页数量）
for cat in [1, 2, 3, 4, 5, 6, 7]:
    try:
        r = s.get(f'https://www.biquges.cc/top/all_{cat}_1.html', headers=UA, timeout=15, verify=False)
        books = re.findall(r'<a[^>]*href="(/\d+/\d+/)"[^>]*>([^<]+)</a>', r.text)
        # 去重
        seen = []
        for u, t in books:
            if u not in [x[0] for x in seen]:
                seen.append((u, t.strip()))
        print(f'分类{cat} 总榜: {len(seen)}本 | 前3: {[t for _, t in seen[:3]]}')
        time.sleep(1.5)
    except Exception as e:
        print(f'分类{cat}: {type(e).__name__}')

# 2. 榜单第2页是否存在（验证翻页）
try:
    r = s.get('https://www.biquges.cc/top/all_1_2.html', headers=UA, timeout=15, verify=False)
    books = re.findall(r'<a[^>]*href="(/\d+/\d+/)"[^>]*>([^<]+)</a>', r.text)
    uniq = len(set(u for u, _ in books))
    print(f'\n玄幻总榜第2页: {r.status_code}, {uniq}本')
    time.sleep(1.5)
except Exception as e:
    print(f'第2页: {type(e).__name__}')

# 3. 书籍详情页（章节列表）
try:
    r = s.get('https://www.biquges.cc/0/143/', headers=UA, timeout=15, verify=False)
    print(f'\n斗破苍穹详情页: {r.status_code}, {len(r.text)}字节')
    chapters = re.findall(r'<a[^>]*href="(/0/143/\d+\.html)"[^>]*>([^<]+)</a>', r.text)
    print(f'章节数: {len(chapters)}')
    for u, t in chapters[:5]:
        print(f'  {u} | {t.strip()}')
    # 书籍信息（作者/简介）
    info = re.search(r'<meta name="description" content="([^"]*)"', r.text)
    if info:
        print('简介:', info.group(1)[:100])
    time.sleep(1.5)
except Exception as e:
    print(f'详情页: {type(e).__name__}')

# 4. 章节正文页
try:
    if chapters:
        r = s.get(f'https://www.biquges.cc{chapters[0][0]}', headers=UA, timeout=15, verify=False)
        print(f'\n章节页: {r.status_code}, {len(r.text)}字节, 编码:{r.encoding}')
        # 正文一般在 div id="content" 或类似容器
        m = re.search(r'<div[^>]*(?:id|class)="(?:content|chaptercontent|txt|showtxt|chapter-content)[^"]*"[^>]*>([\s\S]*?)</div>', r.text)
        if m:
            text = re.sub(r'<[^>]+>|\s+', ' ', m.group(1))[:200]
            print('正文片段:', text)
        else:
            print('正文容器未命中，页面片段:', re.sub(r'\s+', ' ', r.text[2000:2400]))
except Exception as e:
    print(f'章节页: {type(e).__name__}')
