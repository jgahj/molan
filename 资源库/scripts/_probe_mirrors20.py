# -*- coding: utf-8 -*-
"""探测20：找有整本TXT下载的镜像站"""
import re
import time
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

candidates = [
    ('shuquge', 'https://www.shuquge.com'),
    ('shuquge2', 'https://www.shuquge.net'),
    ('dingdian', 'https://www.dingdianxs.net'),
    ('xswbook', 'https://www.xswbook.com'),
    ('biquges.cc移动', 'https://m.biquges.cc'),
]

for name, base in candidates:
    try:
        r = s.get(base, headers=UA, timeout=12, verify=False)
        has_dl = bool(re.search(r'下载|download|\.txt|\.zip|\.rar', r.text, re.I))
        print(f'{name}: {r.status_code}, {len(r.text)}字节, 含下载字样:{has_dl}')
    except Exception as e:
        print(f'{name}: {type(e).__name__} {str(e)[:50]}')
    time.sleep(1)

# xbiquge.la 检查下载功能（用斗破苍穹详情页测）
print('\n== xbiquge.la ==')
try:
    r = s.get('https://www.xbiquge.la/', headers=UA, timeout=12, verify=False)
    print(f'首页: {r.status_code}, {len(r.text)}字节')
    # 找下载入口
    dl = re.findall(r'<a[^>]*href="([^"]*(?:txt|down|zip|pack)[^"]*)"[^>]*>([^<]*)</a>', r.text, re.I)
    print('下载链接:', dl[:5])
    # 找书测搜索
    from urllib.parse import quote
    rs = s.get(f'https://www.xbiquge.la/search.php?q={quote("斗破苍穹")}', headers=UA, timeout=15, verify=False)
    print(f'搜索斗破: {rs.status_code}, 含结果:{"斗破苍穹" in rs.text}')
except Exception as e:
    print(f'{type(e).__name__} {str(e)[:60]}')
