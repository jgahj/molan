# -*- coding: utf-8 -*-
"""探测10：biquges.cc 搜索真实番茄书名 + 解析结果页结构"""
import re
import time
from urllib.parse import quote
from curl_cffi import requests as rq

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://www.biquges.cc/'}
s = rq.Session(impersonate='chrome')

titles = ['宜修换嫁年羹尧', '穿成依萍', '菲林斯在霍格沃兹', '斗破苍穹']
for title in titles:
    q = quote(title)
    for attempt in range(3):
        try:
            r = s.get(f'https://www.biquges.cc/search.php?q={q}', headers=UA, timeout=25, verify=False)
            if r.status_code == 200 and title in r.text:
                # 解析结果（biquge 搜索结果一般是 <a href="/xx/xxx/">书名</a> 作者 格式）
                # 打印所有结果行
                rows = re.findall(r'<a[^>]*href="(/\d+/\d+/)"[^>]*>([^<]+)</a>\s*(?:</td>\s*<td[^>]*>|[^<]*<)[^>]*>?([^<]{0,20})', r.text)
                if not rows:
                    # 宽松提取
                    rows = [(u, t, '') for u, t in re.findall(r'<a[^>]*href="(/\d+/\d+/)"[^>]*>([^<]+)</a>', r.text)]
                print(f'《{title}》找到 {len(rows)} 条:')
                for u, t, a in rows[:6]:
                    print(f'  {u} | {t.strip()[:30]} | {a.strip()[:12]}')
                break
            else:
                print(f'《{title}》尝试{attempt + 1}: {r.status_code} 无结果')
                time.sleep(3)
        except Exception as e:
            print(f'《{title}》尝试{attempt + 1}: {type(e).__name__}')
            time.sleep(3)
    print()
    time.sleep(2)
