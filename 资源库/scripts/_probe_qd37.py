# -*- coding: utf-8 -*-
"""探测37：分类榜单验证 + shukuge 站点地图"""
import re
from curl_cffi import requests as rq

UA_M = {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'}
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

# 1. 各分类畅销榜+新书榜验证
print('== 分类榜单验证 ==')
cats = [('21', '玄幻'), ('1', '奇幻'), ('2', '武侠'), ('22', '仙侠'), ('4', '都市'),
        ('15', '现实'), ('6', '军事'), ('5', '历史'), ('7', '游戏'), ('8', '体育'),
        ('9', '科幻'), ('10', '悬疑灵异'), ('20109', '诸天无限'), ('12', '轻小说')]
for cid, name in cats[:5]:
    for rk in ['hotsales', 'newbook']:
        try:
            r = s.get(f'https://m.qidian.com/rank/{rk}/catid{cid}/', headers=UA_M, timeout=20, verify=False)
            books = re.findall(r'href="//m\.qidian\.com/book/(\d+)/"', r.text)
            print(f'{name}-{rk}: {r.status_code}, {len(set(books))}本')
        except Exception as e:
            print(f'{name}-{rk}: {type(e).__name__}')

# 2. shukuge 站点地图
print('\n== shukuge 站点地图 ==')
try:
    r2 = s.get('http://www.shukuge.com/map/all.xml', headers=UA, timeout=30, verify=False)
    print(f'地图: {r2.status_code}, {len(r2.text)}字节')
    urls = re.findall(r'<loc>([^<]+)</loc>', r2.text)
    print(f'URL数: {len(urls)}')
    for u in urls[:8]:
        print(' ', u)
    # 有多少本书
    book_urls = [u for u in urls if '/book/' in u]
    print(f'书籍URL数: {len(book_urls)}')
except Exception as e:
    print(f'{type(e).__name__} {str(e)[:60]}')
