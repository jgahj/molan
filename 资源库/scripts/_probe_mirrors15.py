# -*- coding: utf-8 -*-
"""探测15：章节正文容器分析"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://www.biquges.cc/0/143/'}
s = rq.Session(impersonate='chrome')

r = s.get('https://www.biquges.cc/0/143/1.html', headers=UA, timeout=15, verify=False)
print(f'第1章页: {r.status_code}, {len(r.text)}字节')

# 所有 div 容器 id/class
divs = re.findall(r'<div[^>]*(?:id|class)="([^"]+)"[^>]*>', r.text)
print('容器:', divs[:20])

# 常见正文容器逐个试
for cid in ['content', 'chaptercontent', 'txt', 'showtxt', 'chapter-content', 'booktxt', 'nr_txt', 'contentbox', 'txtnav', 'readerCon']:
    m = re.search(rf'<div[^>]*(?:id|class)="[^"]*{cid}[^"]*"[^>]*>([\s\S]*?)</div>', r.text)
    if m and len(m.group(1)) > 500:
        text = re.sub(r'<br\s*/?>', '\n', m.group(1))
        text = re.sub(r'<[^>]+>', '', text).strip()
        print(f'\n命中容器 "{cid}": {len(text)}字')
        print('开头:', text[:150])
        print('结尾:', text[-100:])
        break

# 检查目录是否分页（找 下一页/分页链接）
r2 = s.get('https://www.biquges.cc/0/143/', headers=UA, timeout=15, verify=False)
pages = re.findall(r'href="(/0/143/[^"]*)"', r2.text)
uniq = list(dict.fromkeys(pages))
print(f'\n目录页内链接数: {len(uniq)}')
# 找 _2.html _3.html 之类的分页
pagin = [p for p in uniq if re.search(r'/0/143/_?\d+\.html|index_\d+', p)]
print('分页线索:', pagin[:10])
# 章节总数再确认
chaps = re.findall(r'href="(/0/143/\d+\.html)"', r2.text)
print(f'章节链接总数: {len(set(chaps))}')
