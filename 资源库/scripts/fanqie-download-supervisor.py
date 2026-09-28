# -*- coding: utf-8 -*-
"""
番茄下载守护进程
功能：循环调用 fanqie-batch-download.py 直至全部书籍完成；
     下载进程异常退出（崩溃/被杀）时自动重启，断点续传由进度文件保证；
     每轮开始前探测阅读页是否仍被验证码封禁，封禁中则等待后重试。
背景：并行下载需长时间运行，单次进程意外退出会丢失在途书籍，守护进程兜底。
"""
import json
import os
import re
import subprocess
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(SCRIPT_DIR, 'fanqie-batch-download.py')
ROOT = os.path.dirname(SCRIPT_DIR)
PROGRESS_PATH = os.path.join(SCRIPT_DIR, 'fanqie-download-progress.json')
MANIFEST_PATH = os.path.join(ROOT, 'fanqie-rank-manifest.json')
MAX_ROUNDS = 200
ROUND_GAP_SECONDS = 10
BAN_WAIT_SECONDS = 120     # 封禁探测等待间隔（2 分钟，换 IP 后快速接续）
WORKERS = 1                # 顺序下载（单线程），最稳妥不触发风控


def count_remaining():
    """统计未完成（非 ok 状态且未放弃）的书籍数"""
    with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    done = set()
    if os.path.exists(PROGRESS_PATH):
        try:
            with open(PROGRESS_PATH, 'r', encoding='utf-8') as f:
                progress = json.load(f)
            done = {bid for bid, v in progress.items()
                    if v.get('status') == 'ok'
                    or (v.get('status') == 'mostly_empty' and v.get('attempts', 0) >= 3)}
        except Exception:
            done = set()
    seen = set()
    total = 0
    for cat in manifest.get('categories', []):
        for rank_name in ('畅销榜', '新书榜'):
            for book in cat.get('ranks', {}).get(rank_name, []):
                bid = str(book.get('bookId') or '')
                if bid and bid not in seen:
                    seen.add(bid)
                    total += 1
    remaining = sum(1 for bid in seen if bid not in done)
    return total, remaining


def probe_unblocked():
    """探测阅读页是否解封：返回 True 表示可正常访问"""
    try:
        from curl_cffi import requests as rq
        s = rq.Session(impersonate='chrome')
        r = s.get('https://fanqienovel.com/reader/7669342959321498136',
                  headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'},
                  timeout=25)
        ok = r.status_code == 200 and '__INITIAL_STATE__' in r.text and '验证码中间页' not in r.text
        return ok
    except Exception:
        return False


def wait_for_unblock(max_wait_hours=24):
    """等待解封：封禁中每 10 分钟探测一次"""
    deadline = time.time() + max_wait_hours * 3600
    while time.time() < deadline:
        if probe_unblocked():
            return True
        print(f'[supervisor] 阅读页仍被风控封禁，{BAN_WAIT_SECONDS // 60} 分钟后重新探测...')
        sys.stdout.flush()
        time.sleep(BAN_WAIT_SECONDS)
    return False


def main():
    """主循环：探测解封 → 重启下载进程直至剩余为 0"""
    for round_no in range(1, MAX_ROUNDS + 1):
        total, remaining = count_remaining()
        if remaining == 0:
            print(f'[supervisor] 全部 {total} 本已完成，守护结束')
            return
        print(f'[supervisor] 第 {round_no} 轮启动：总 {total} 本，剩余 {remaining} 本')
        print(f'[supervisor] 时间: {time.strftime("%Y-%m-%d %H:%M:%S")}')
        sys.stdout.flush()
        if not wait_for_unblock():
            print('[supervisor] 等待解封超时，退出')
            return
        print(f'[supervisor] 阅读页已解封，开始本轮下载')
        sys.stdout.flush()
        try:
            proc = subprocess.run([sys.executable, '-u', SCRIPT, '--workers', str(WORKERS)])
            code = proc.returncode
        except Exception as e:
            code = -1
            print(f'[supervisor] 启动异常: {e!r}')
        _, remaining_after = count_remaining()
        print(f'[supervisor] 第 {round_no} 轮结束，退出码 {code}，剩余 {remaining_after} 本')
        sys.stdout.flush()
        if remaining_after == 0:
            print('[supervisor] 全部完成，守护结束')
            return
        time.sleep(ROUND_GAP_SECONDS)
    print('[supervisor] 达到最大轮次上限，退出（可手动重新运行继续）')


if __name__ == '__main__':
    main()
