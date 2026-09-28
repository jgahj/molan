# -*- coding: utf-8 -*-
"""探测16：完整容器列表 + 正文定位"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://www.biquges.cc/0/143/'}
s = rq.Session(impersonate='chrome')

r = s.get('https://www.biquges.cc/0/143/1.html', headers=UA, timeout=15, verify=False)

# 所有带 id 的元素
ids = re.findall(r'<(?:div|article|section)[^>]*\bid="([^"]+)"', r.text)
print('所有id:', ids)

# 找最长的文本块（按 <div> 拆分统计各块文本量）
blocks = re.split(r'(<div[^>]*>)', r.text)
cur_tag = ''
best = ('', 0, '')
for i in range(1, len(blocks), 2):
    tag = blocks[i]
    content = blocks[i + 1] if i + 1 < len(blocks) else ''
    text_len = len(re.sub(r'<[^>]+>|\s', '', content))
    if text_len > best[1]:
        best = (tag, text_len, content)
print(f'\n最大文本块: {best[0][:80]}')
print(f'文本量: {best[1]}字')
text = re.sub(r'<br\s*/?>', '\n', best[2][:5000])
text = re.sub(r'<[^>]+>', '', text).strip()
print('内容预览:', text[:300])
