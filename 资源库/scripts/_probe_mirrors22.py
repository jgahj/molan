# -*- coding: utf-8 -*-
"""探测22：biquges.cc 反爬承受力测试（快速连发20个章节页）"""
import re
import time
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}
s = rq.Session(impersonate='chrome')

# 取斗破苍穹的一批章节URL（从目录页）
r = s.get('https://www.biquges.cc/0/143/index_20.html', headers=UA, timeout=15, verify=False)
chaps = re.findall(r'href="(/0/143/(\d+)\.html)"', r.text)
urls = [f'https://www.biquges.cc{u}' for u, _ in chaps[:20]]
print(f'测试 {len(urls)} 个章节页，间隔0.4秒（约2.5请求/秒）')

ok = fail = 0
t0 = time.time()
for i, u in enumerate(urls):
    try:
        r = s.get(u, headers=UA, timeout=12, verify=False)
        # 正文标志：含 &nbsp;&nbsp;&nbsp;&nbsp; 缩进或'第('分页标记
        good = r.status_code == 200 and ('第(' in r.text or '&nbsp;' in r.text)
        ok += good
        fail += (not good)
        if not good:
            print(f'  [{i}] {u}: {r.status_code} 异常!')
    except Exception as e:
        fail += 1
        print(f'  [{i}] {type(e).__name__}')
    time.sleep(0.4)

cost = time.time() - t0
print(f'\n结果: 成功{ok} 失败{fail}, 耗时{cost:.0f}秒, 平均{cost / len(urls):.2f}秒/请求')
