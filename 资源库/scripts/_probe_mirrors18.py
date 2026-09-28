# -*- coding: utf-8 -*-
"""探测18：章节内部分页机制"""
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://www.biquges.cc/0/143/155931.html'}
s = rq.Session(impersonate='chrome')

# 章节 155931.html 显示 第(1/3)页，试常见分页格式
for suffix in ['155931_2.html', '155931-2.html', '155931_2/', '155931.html?_p=2']:
    try:
        r = s.get(f'https://www.biquges.cc/0/143/{suffix}', headers=UA, timeout=15, verify=False)
        # 检查是否含第2页标记
        has2 = '第(2/3)页' in r.text or '(2/3)' in r.text
        print(f'{suffix}: {r.status_code}, {len(r.text)}字节, 含第2页标记:{has2}')
    except Exception as e:
        print(f'{suffix}: {type(e).__name__}')

# 从原页面找下一页按钮的链接
r = s.get('https://www.biquges.cc/0/143/155931.html', headers=UA, timeout=15, verify=False)
# 找 "下一页" 或 章内导航的 JS
nxt = re.findall(r'href="([^"]*15593[12][^"]*)"', r.text)
print('页内相关链接:', list(set(nxt))[:8])
# JS 分页线索
js = re.findall(r'(?:page|next)[^;]{0,100}', r.text)[:5]
for j in js:
    if len(j) > 10:
        print('JS:', j[:120])
