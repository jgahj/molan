# -*- coding: utf-8 -*-
"""探测9：biquges.cc 搜索重试（后端过载，需耐心重试）"""
import re
import time
from urllib.parse import quote
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://www.biquges.cc/'}
s = rq.Session(impersonate='chrome')

title = '斗破苍穹'
q = quote(title)
for attempt in range(6):
    try:
        r = s.get(f'https://www.biquges.cc/search.php?q={q}', headers=UA, timeout=25, verify=False)
        has = title in r.text
        print(f'尝试{attempt + 1}: {r.status_code}, {len(r.text)}字节, 含"{title}":{has}')
        if has:
            # 提取书籍链接（biquge 书籍页一般是 /book/123/ 或 /123_456/ 形式）
            links = re.findall(r'<a[^>]*href="([^"]*/(?:\d+/|book/)[^"]*)"[^>]*>([^<]*)</a>', r.text)
            for u, t in links[:10]:
                if title[:2] in t:
                    print('  匹配:', u, t.strip())
            break
    except Exception as e:
        print(f'尝试{attempt + 1}: {type(e).__name__}')
    time.sleep(4)
