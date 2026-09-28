# -*- coding: utf-8 -*-
"""探测27：城通 webapi 直调"""
import json
import re
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://url91.ctfile.com/f/37476991-1460132014-cbe30d?p=txtxiaoshuo',
      'Origin': 'https://url91.ctfile.com'}
s = rq.Session(impersonate='chrome')

# 先访问页面拿 cookie
r0 = s.get('https://url91.ctfile.com/f/37476991-1460132014-cbe30d?p=txtxiaoshuo', headers=UA, timeout=20, verify=False)
print('cookies:', list(s.cookies.keys()))

path = '/f/37476991-1460132014-cbe30d'

# 尝试各种 API 端点
apis = [
    f'https://webapi.ctfile.com/getfile.php?path={path}&passwd=txtxiaoshuo',
    f'https://webapi.ctfile.com/getfile.php?path={path}&pass=txtxiaoshuo',
    f'https://webapi.ctfile.com/getfileurl.php?path={path}&passwd=txtxiaoshuo',
    f'https://webapi.ctfile.com/file_info.php?path={path}',
    f'https://webapi.ctfile.com/getfile.php?path={path}&passwd=txtxiaoshuo&uid=37476991&fid=1460132014&folder_id=0',
]
for api in apis:
    try:
        r = s.get(api, headers=UA, timeout=15, verify=False)
        body = r.text[:300].replace('\n', ' ')
        print(f'{api.split(".com/")[1][:45]}: {r.status_code} | {body[:200]}')
    except Exception as e:
        print(f'{api.split(".com/")[1][:45]}: {type(e).__name__}')
