# -*- coding: utf-8 -*-
"""探测各笔趣阁系镜像站/聚合站的可用性与搜索功能"""
import time
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}

# 候选镜像站列表（笔趣阁系 + 常见聚合站）
SITES = [
    ('xbiquge.la', 'https://www.xbiquge.la'),
    ('bqgui.cc', 'https://www.bqgui.cc'),
    ('biqu5200.net', 'https://www.biqu5200.net'),
    ('xbiqugv.com', 'https://www.xbiqugv.com'),
    ('biquges.com', 'https://www.biquges.com'),
    ('qxs.la', 'https://www.qxs.la'),
    ('biquwx.la', 'https://www.biquwx.la'),
    ('13744.xs', 'https://www.13744.xs'),
    ('biquge5200.cc', 'https://www.biquge5200.cc'),
    ('63xs.com', 'https://www.63xs.com'),
]

s = rq.Session(impersonate='chrome')
for name, base in SITES:
    try:
        t0 = time.time()
        r = s.get(base, headers=UA, timeout=12)
        ok = r.status_code == 200 and len(r.text) > 1000
        # 探测搜索接口
        search_ok = ''
        if ok:
            try:
                rs = s.get(f'{base}/search.php', params={'q': '斗破苍穹'}, headers=UA, timeout=12)
                search_ok = f'搜索 {rs.status_code}/{len(rs.text)}'
            except Exception as e:
                search_ok = f'搜索失败 {type(e).__name__}'
        cost = round(time.time() - t0, 1)
        print(f'{name}: {"可用" if ok else "不可用"} ({r.status_code}, {len(r.text)}字节, {cost}s) {search_ok}')
    except Exception as e:
        print(f'{name}: 不可达 ({type(e).__name__}: {str(e)[:60]})')
    time.sleep(1)
