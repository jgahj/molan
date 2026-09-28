#!/usr/bin/env python3
"""调用固定提交版 fanqienovel-downloader，顺序抓取一本已授权番茄作品。"""

import argparse
import builtins
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


EXPECTED_PROJECT_COMMIT = "4cbb46e9038f2d714407745898380cf02c629deb"
REPOSITORY_URL = "https://github.com/ying-ck/fanqienovel-downloader"
MIN_DELAY_MS = 2000


def parse_arguments(argv):
    """读取单本番茄作品的驱动参数。

    参数：argv 为命令行参数数组。
    返回值：argparse 解析后的参数对象。
    """
    parser = argparse.ArgumentParser(description="使用固定版本番茄小说下载器顺序导出一本完整作品")
    parser.add_argument("--project-root", required=True, help="fanqienovel-downloader 仓库根目录")
    parser.add_argument("--work-id", required=True, help="番茄作品 ID")
    parser.add_argument("--source-url", required=True, help="番茄作品目录页 URL")
    parser.add_argument("--title", required=True, help="清单中的作品标题")
    parser.add_argument("--author", default="", help="清单中的作者")
    parser.add_argument("--output", required=True, help="资源库内原书 TXT 输出路径")
    parser.add_argument("--result", required=True, help="不含正文的抓取结果 JSON 路径")
    parser.add_argument("--delay-ms", type=int, default=MIN_DELAY_MS, help="章节请求之间的最小间隔，至少 2000")
    parser.add_argument("--allow-overwrite", action="store_true", help="允许覆盖已有不同内容的目标文件")
    return parser.parse_args(argv)


def sha256_bytes(value):
    """计算字节内容的完整 SHA-256。

    参数：value 为 bytes。
    返回值：小写十六进制 SHA-256 字符串。
    """
    return hashlib.sha256(value).hexdigest()


def corpus_char_count(value):
    """按资源库口径统计去除空白后的字符数。

    参数：value 为正文字符串。
    返回值：去除 Unicode 空白后的字符数量。
    """
    return len(re.sub(r"\s+", "", str(value or "")))


def normalized_title(value):
    """生成用于比对作品标题的保守规范形式。

    参数：value 为作品标题。
    返回值：去除书名号和空白后的标题。
    """
    return re.sub(r"[《》\s]+", "", str(value or "")).strip()


def utc_now():
    """生成带 Z 后缀的当前 UTC 时间。

    参数：无。
    返回值：ISO-8601 时间字符串。
    """
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def project_commit(project_root):
    """读取下载器仓库当前提交并强制校验固定版本。

    参数：project_root 为下载器仓库根目录。
    返回值：通过校验的完整 Git 提交哈希。
    """
    try:
        completed = subprocess.run(
            ["git", "-C", str(project_root), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise RuntimeError(f"无法读取下载器 Git 提交：{error}") from error
    commit = completed.stdout.strip().lower()
    if commit != EXPECTED_PROJECT_COMMIT:
        raise RuntimeError(
            f"下载器提交不匹配：实际 {commit or '空值'}，要求 {EXPECTED_PROJECT_COMMIT}"
        )
    return commit


def ensure_project_runtime(project_root):
    """为上游交互式模块准备不覆盖用户配置的最小运行时目录。

    参数：project_root 为下载器仓库根目录。
    返回值：上游 src 目录路径。
    """
    src_root = project_root / "src"
    main_path = src_root / "main.py"
    if not main_path.is_file():
        raise RuntimeError(f"找不到下载器入口：{main_path}")
    data_root = src_root / "data"
    bookstore_root = data_root / "bookstore"
    data_root.mkdir(parents=True, exist_ok=True)
    bookstore_root.mkdir(parents=True, exist_ok=True)
    config_path = data_root / "config.json"
    if not config_path.exists():
        config = {
            "kg": 0,
            "kgf": "　",
            "delay": [2000, 2000],
            "save_path": "",
            "save_mode": 1,
            "space_mode": "halfwidth",
            "xc": 1,
            "enable_chapter_numbering": False,
            "auto_retry": True,
            "max_retries": 3,
            "timeout": 35,
            "version": "1.1.16",
            "auto_backup": False,
            "api_key": "",
            "json_save_interval": 20,
        }
        config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"下载器配置不可读取：{config_path}；{error}") from error
        required = {
            "kg",
            "kgf",
            "delay",
            "save_path",
            "save_mode",
            "space_mode",
            "xc",
            "enable_chapter_numbering",
            "auto_retry",
            "max_retries",
            "timeout",
            "version",
        }
        missing = sorted(required.difference(config))
        if missing:
            raise RuntimeError(f"下载器配置缺少字段：{', '.join(missing)}；请修复 {config_path}")
    return src_root


def load_upstream_module(src_root):
    """在不进入上游交互主循环的前提下加载其下载函数。

    参数：src_root 为下载器 src 目录。
    返回值：已加载的上游 Python 模块。
    """
    module_path = src_root / "main.py"
    module_name = f"fanqie_upstream_main_{os.getpid()}"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载下载器模块：{module_path}")
    module = importlib.util.module_from_spec(spec)
    original_input = builtins.input
    builtins.input = lambda _prompt="": "7"
    try:
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
    except SystemExit as error:
        raise RuntimeError(f"下载器初始化提前退出，配置或依赖可能不完整：{error}") from error
    finally:
        builtins.input = original_input
    return module


def configure_upstream(module, delay_ms):
    """把上游下载器运行时固定为单线程和合规请求间隔。

    参数：module 为已加载的上游模块；delay_ms 为章节请求最小间隔。
    返回值：无。
    """
    if delay_ms < MIN_DELAY_MS:
        raise ValueError(f"--delay-ms 不得小于 {MIN_DELAY_MS}")
    runtime = getattr(module, "config", None)
    if runtime is None or not isinstance(getattr(runtime, "config", None), dict):
        raise RuntimeError("下载器运行时配置对象不可用")
    runtime.config["kg"] = 0
    runtime.config["xc"] = 1
    runtime.config["delay"] = [delay_ms, delay_ms]
    runtime.config["save_mode"] = 1
    runtime.config["auto_backup"] = False


def fetch_chapters(module, work_id, delay_ms):
    """通过固定版本下载器依次读取目录和每个章节正文。

    参数：module 为上游模块；work_id 为番茄作品 ID；delay_ms 为章节请求间隔。
    返回值：作品标题、平台状态、按目录顺序的章节记录数组。
    """
    directory = module.down_zj(int(work_id))
    if not isinstance(directory, (list, tuple)) or len(directory) < 3:
        raise RuntimeError("下载器没有返回有效目录结果")
    title = str(directory[0] or "").strip()
    chapter_map = directory[1]
    statuses = directory[2]
    if title == "err" or not isinstance(chapter_map, dict) or not chapter_map:
        raise RuntimeError("番茄目录页未返回可下载章节")
    status = next((str(item).strip() for item in statuses if str(item).strip()), "") if isinstance(statuses, list) else ""
    if not re.search(r"完结|完本|完成", status):
        raise RuntimeError(f"作品状态不是已完结：{status or '未知'}")

    chapters = []
    for index, (chapter_title, chapter_id) in enumerate(chapter_map.items()):
        time.sleep(delay_ms / 1000)
        content, failed = module.down_text(str(chapter_id), 1)
        content = str(content or "").strip()
        if failed or not content:
            raise RuntimeError(f"第 {index + 1} 章下载失败：{chapter_title}")
        chapters.append(
            {
                "chapterIndex": index,
                "chapterId": str(chapter_id).strip(),
                "title": str(chapter_title).strip(),
                "chars": corpus_char_count(content),
                "contentHash": sha256_bytes(content.encode("utf-8")),
                "text": content,
            }
        )
        if (index + 1) % 20 == 0 or index + 1 == len(chapter_map):
            print(f"[fanqie-driver] {title}: {index + 1}/{len(chapter_map)} 章", flush=True)
    return title, status, chapters


def build_catalog_snapshot(source_url, captured_at, chapters):
    """根据上游目录返回的章节 ID生成可重验目录快照。

    参数：source_url 为作品目录 URL；captured_at 为采集时间；chapters 为章节记录数组。
    返回值：含完整 SHA-256 的目录快照对象。
    """
    payload = {
        "sourceUrl": source_url,
        "capturedAt": captured_at,
        "chapterCount": len(chapters),
        "chapterIds": [chapter["chapterId"] for chapter in chapters],
        "chapters": [
            {"chapterId": chapter["chapterId"], "title": chapter["title"], "url": ""}
            for chapter in chapters
        ],
    }
    snapshot = dict(payload)
    snapshot["duplicateChapterIds"] = []
    snapshot["snapshotSha256"] = sha256_bytes(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    return snapshot


def render_archive(title, author, source_url, status, chapters):
    """把章节正文渲染为资源库可解析的单文件原书。

    参数：title、author、source_url、status 为作品元数据；chapters 为章节记录数组。
    返回值：UTF-8 原书文本字符串。
    """
    lines = [
        f"小说名：{title}",
        f"作者：{author}",
        f"来源：{source_url}",
        f"状态：{status}",
        "",
    ]
    for chapter in chapters:
        lines.extend([chapter["title"], "", chapter["text"], ""])
    return "\n".join(lines).rstrip() + "\n"


def write_archive(output_path, archive_text, allow_overwrite):
    """以临时文件加原子替换方式写入原书归档。

    参数：output_path 为目标 TXT 路径；archive_text 为完整原书文本；allow_overwrite 为覆盖开关。
    返回值：created 或 overwritten。
    """
    target = Path(output_path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    existed_before_write = target.exists()
    if existed_before_write and not allow_overwrite:
        raise RuntimeError(f"目标原书已存在，拒绝覆盖：{target}")
    temporary = target.with_name(f"{target.name}.part-{os.getpid()}")
    try:
        temporary.write_bytes(archive_text.encode("utf-8"))
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()
    return "overwritten" if existed_before_write else "created"


def write_result(result_path, result):
    """写入不包含章节正文的抓取结果 JSON。

    参数：result_path 为结果 JSON 路径；result 为可序列化的元数据对象。
    返回值：无。
    """
    target = Path(result_path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run(argv):
    """执行单本作品的固定版本下载流程。

    参数：argv 为命令行参数数组。
    返回值：成功返回 0，失败返回 1。
    """
    args = parse_arguments(argv)
    if not re.fullmatch(r"\d+", str(args.work_id).strip()):
        raise ValueError("--work-id 必须是数字")
    if args.delay_ms < MIN_DELAY_MS:
        raise ValueError(f"--delay-ms 不得小于 {MIN_DELAY_MS}")

    project_root = Path(args.project_root).resolve()
    commit = project_commit(project_root)
    src_root = ensure_project_runtime(project_root)
    module = load_upstream_module(src_root)
    configure_upstream(module, args.delay_ms)
    captured_at = utc_now()
    actual_title, status, chapters = fetch_chapters(module, args.work_id, args.delay_ms)
    if normalized_title(actual_title) != normalized_title(args.title):
        raise RuntimeError(f"作品标题与清单不一致：清单为《{args.title}》，目录为《{actual_title}》")
    archive_text = render_archive(actual_title, args.author, args.source_url, status, chapters)
    archive_bytes = archive_text.encode("utf-8")
    archive_action = write_archive(Path(args.output), archive_text, args.allow_overwrite)
    snapshot = build_catalog_snapshot(args.source_url, captured_at, chapters)
    result = {
        "schemaVersion": "fanqie-project-result-1",
        "title": actual_title,
        "author": args.author,
        "sourceUrl": args.source_url,
        "platform": "番茄",
        "platformWorkId": str(args.work_id),
        "status": status,
        "fetchedAt": captured_at,
        "chapterCount": len(chapters),
        "fetchedChapterCount": len(chapters),
        "totalChars": corpus_char_count(archive_text),
        "contentHash": sha256_bytes(archive_bytes),
        "catalogSnapshot": snapshot,
        "chapters": [
            {key: value for key, value in chapter.items() if key != "text"}
            for chapter in chapters
        ],
        "archiveAction": archive_action,
        "projectRepository": REPOSITORY_URL,
        "projectCommit": commit,
    }
    write_result(args.result, result)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(run(sys.argv[1:]))
    except Exception as error:
        print(f"fanqie-project-driver: {error}", file=sys.stderr)
        raise SystemExit(1)
