# -*- coding: utf-8 -*-
"""探测42：起点书页元数据（完结状态/字数/分类）可获取性"""
import re
from curl_cffi import requests as rq

UA_M = {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'}
s = rq.Session(impersonate='chrome')

# 夜无疆(连载) + 捞尸人 + 一本已知的完结老书(诡秘之主 1010868264)
for bid in ['1040765595', '1010868264']:
    r = s.get(f'https://m.qidian.com/book/{bid}/', headers=UA_M, timeout=20, verify=False)
    print(f'== book {bid}: {r.status_code}, {len(r.text)}字节 ==')
    # 完结状态
    for pat in [r'(连载中|已完结|完本|连载)', r'"bookStatus"\s*:\s*"([^"]+)"',
                r'(?:状态|Status)[：:]\s*</[^>]+>\s*([^<]{2,8})']:
        m = re.findall(pat, r.text)
        if m:
            print(' 状态线索:', list(dict.fromkeys(m))[:4])
    # 字数
    wm = re.findall(r'(\d+(?:\.\d+)?)\s*(?:万)?字', r.text)
    print(' 字数线索:', wm[:5])
    # 分类
    cm = re.findall(r'<title>([^<]+)</title>', r.text)
    print(' 标题:', cm[0][:60] if cm else '?')
