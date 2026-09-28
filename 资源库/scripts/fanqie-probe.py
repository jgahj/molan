# 1) 找 muye.js 请求拦截器追加的公共参数 2) 测试移动版书库 SSR 3) 测试榜单翻页参数
import re
import json
from curl_cffi import requests as rq

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'}


def parse_state(t):
    """raw_decode 解析 window.__INITIAL_STATE__"""
    m = re.search(r'window\.__INITIAL_STATE__\s*=\s*', t)
    if not m:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(t[m.end():])
        return obj
    except Exception:
        return None


def main():
    t = open(r'资源库\scripts\muye.js', encoding='utf-8', errors='ignore').read()
    # 找 axios/fetch 拦截器：搜 params 合并处（device_id / iid / aid）
    for kw in ['device_id', 'iid:', 'aid:', 'app_id=']:
        hits = [m.start() for m in re.finditer(re.escape(kw), t)][:3]
        for pos in hits:
            s = max(0, pos - 150)
            print(f'[{kw}]', t[s:pos + 200].replace('\n', ' ')[:330])
            print('----')
        if not hits:
            print(f'[{kw}] 无命中')
    print('======')
    # 移动版书库
    r = rq.get('https://fanqienovel.com/library/all/page_1?force_mobile=1',
               headers={**HEADERS, 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'},
               timeout=20, impersonate='chrome')
    pages = set(re.findall(r'/page/(\d{5,})', r.text))
    print('移动书库:', r.status_code, len(r.text), '书号数:', len(pages))
    # 榜单页翻页测试
    for suffix in ['?page=2', '?offset=10', '?defaultPage=2']:
        r2 = rq.get(f'https://fanqienovel.com/rank/1_1_258{suffix}',
                    headers=HEADERS, timeout=20, impersonate='chrome')
        st = parse_state(r2.text) or {}
        bl = (st.get('rank') or {}).get('book_list') or []
        first = bl[0].get('bookId') if bl else None
        print(f'翻页{suffix}: book_list={len(bl)} 首书={first}')


if __name__ == '__main__':
    main()
