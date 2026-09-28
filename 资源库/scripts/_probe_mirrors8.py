# -*- coding: utf-8 -*-
"""探测8：番茄移动站 + APP API（不同域名，可能未被封）"""
from curl_cffi import requests as rq

UA_WEB = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
UA_MOBILE = {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'}
s = rq.Session(impersonate='chrome')

ITEM = '7669342959321498136'
BOOK = '7667187118745062424'

# 1. 移动站阅读页
try:
    r = s.get(f'https://m.fanqienovel.com/reader/{ITEM}', headers=UA_MOBILE, timeout=20)
    ok = r.status_code == 200 and ('__INITIAL_STATE__' in r.text or 'chapterContent' in r.text or len(r.text) > 50000)
    print(f'm.fanqienovel.com 阅读页: {r.status_code}, {len(r.text)}字节, 可能可用:{ok}')
    if r.status_code != 200 or len(r.text) < 5000:
        print('  内容片段:', r.text[:150].replace(chr(10), ' '))
except Exception as e:
    print(f'm站: {type(e).__name__} {str(e)[:60]}')

# 2. APP API（fqnovel.com 域）
try:
    r = s.get(f'https://api5-normal-lf.fqnovel.com/reading/reader/full/v/?item_id={ITEM}&device_platform=android&parent_enterfrom=homepage_channel&type=&uid=&device_id=3527894796&iid=466614321180096&aid=1967', headers=UA_MOBILE, timeout=20)
    print(f'APP API: {r.status_code}, {len(r.text)}字节')
    if r.status_code == 200:
        print('  前200字:', r.text[:200].replace(chr(10), ' '))
except Exception as e:
    print(f'APP API: {type(e).__name__} {str(e)[:60]}')
