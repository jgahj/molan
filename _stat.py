# -*- coding: utf-8 -*-
"""统计 raw 各书有效章节数与总字数，标记过短/空文件，并抽样检查正文质量"""
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raws")

for book in sorted(os.listdir(ROOT)):
    d = os.path.join(ROOT, book)
    if not os.path.isdir(d):
        continue
    files = sorted(f for f in os.listdir(d) if f.endswith(".txt"))
    total = 0
    short = []
    for f in files:
        with open(os.path.join(d, f), encoding="utf-8") as fh:
            t = fh.read()
        total += len(t)
        if len(t) < 150:
            short.append((f, len(t)))
    print(f"{book}: {len(files)}章 / {total}字  过短: {short[:8]}")
    # 抽样检查一章正文头部，验证无评论噪音
    real = [f for f in files]
    sample = os.path.join(d, sorted(real)[len(real)//2])
    if os.path.exists(sample):
        with open(sample, encoding="utf-8") as fh:
            head = fh.read()[:120].replace("\n", " ")
        print(f"    抽样[{os.path.basename(sample)}]: {head}")
print("DONE")