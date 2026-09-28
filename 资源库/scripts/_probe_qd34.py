# -*- coding: utf-8 -*-
"""探测34：解析月票榜条目结构"""
import re
from curl_cffi import requests as rq

UA_M = {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'}
s = rq.Session(impersonate='chrome')

r = s.get('https://m.qidian.com/rank/yuepiao/', headers=UA_M, timeout=20, verify=False)

# 找一个书名的完整 HTML 块
idx = r.text.find('捞尸人')
print('== 捞尸人 上下文 ==')
print(r.text[max(0, idx - 800):idx + 400])
