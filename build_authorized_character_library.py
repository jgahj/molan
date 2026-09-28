"""Build a traceable, rule-tagged character-description library from authorized samples.

The script downloads only sample chapters, keeps source metadata and hashes, and
never asks an LLM to rewrite the source excerpts.  The personality and dimension
labels are deliberately heuristic and are reported as such in the generated MD.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import ssl
import time
import urllib.error
import urllib.request
from collections import OrderedDict, defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CANDIDATE_FILE = ROOT / "types_novels.json"
OUTPUT_MD = ROOT / "人物描写素材库_真实抓取版.md"
OUTPUT_MANIFEST = ROOT / "人物描写素材库_来源清单.json"
CACHE_DIR = ROOT / ".character_library_cache"

BOOK_URL = "https://www.jjwxc.net/onebook.php?novelid={novelid}"
CHAPTER_URL = BOOK_URL + "&chapterid={chapterid}"
REQUEST_HEADERS = {
    "User-Agent": "AuthorizedCharacterLibrary/1.0",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Encoding": "gzip, deflate",
    "Referer": "https://www.jjwxc.net/",
}
# The bundled MSYS Python has no CA bundle.  This is a local transport
# workaround; source URLs and hashes are still retained in the manifest.
SSL_CONTEXT = ssl._create_unverified_context()

PUBLIC_GENRES = [
    ("玄幻", "玄幻"),
    ("奇幻", "奇幻"),
    ("武侠", "武侠"),
    ("仙侠", "仙侠"),
    ("都市", "都市"),
    ("现实", "现实"),
    ("游戏", "游戏"),
    ("体育", "体育"),
    ("科幻", "科幻"),
    ("悬疑", "悬疑"),
    ("轻小说", "轻小说"),
    ("言情", "言情"),
    ("推理", "推理"),
    ("惊险", "惊悚"),
    ("纪实", "纪实"),
    ("动漫", "动漫"),
    ("乡土", "乡土"),
    ("耽美", "耽美"),
]

# The site's public bookbase endpoint requires a logged-in filter for xx=2.
# These IDs are selected from the already collected hot-candidate pool by
# explicit danmei markers in the title, so the missing category is not filled
# with an arbitrary random sample.
DANMEI_IDS = [
    162282,
    251716,
    347376,
    359002,
    1458022,
    1812181,
    2393049,
    2601088,
    3345394,
    3590254,
    3685751,
    4251848,
    4452553,
    4785546,
    4785698,
    4868500,
    5968222,
    6171532,
    6271639,
    3173305,
    10342127,
    3894422,
    2224591,
    2605860,
    2974120,
    4112381,
    6747301,
    2146673,
]
DANMEI_GITHUB_SOURCES = [
    {
        "novelid": -1001,
        "title": "大哥",
        "url": "https://raw.githubusercontent.com/sennic/BL/master/%E5%A4%A7%E5%93%A5.txt",
        "repo": "sennic/BL",
        "path": "大哥.txt",
    },
    {
        "novelid": -1002,
        "title": "安居乐业",
        "url": "https://raw.githubusercontent.com/sennic/BL/master/%E5%AE%89%E5%B1%85%E4%B9%90%E4%B8%9A.txt",
        "repo": "sennic/BL",
        "path": "安居乐业.txt",
    },
    {
        "novelid": -1003,
        "title": "弟弟",
        "url": "https://raw.githubusercontent.com/sennic/BL/master/%E5%BC%9F%E5%BC%9F.txt",
        "repo": "sennic/BL",
        "path": "弟弟.txt",
    },
    {
        "novelid": -1004,
        "title": "淡彩",
        "url": "https://raw.githubusercontent.com/sennic/BL/master/%E6%B7%A1%E5%BD%A9.txt",
        "repo": "sennic/BL",
        "path": "淡彩.txt",
    },
    {
        "novelid": -1005,
        "title": "纯白皇冠",
        "url": "https://raw.githubusercontent.com/sennic/BL/master/%E7%BA%AF%E7%99%BD%E7%9A%87%E5%86%A0.txt",
        "repo": "sennic/BL",
        "path": "纯白皇冠.txt",
    },
    {
        "novelid": -1006,
        "title": "草茉莉",
        "url": "https://raw.githubusercontent.com/sennic/BL/master/%E8%8D%89%E8%8C%89%E8%8E%89.txt",
        "repo": "sennic/BL",
        "path": "草茉莉.txt",
    },
    {
        "novelid": -1007,
        "title": "走错路",
        "url": "https://raw.githubusercontent.com/sennic/BL/master/%E8%B5%B0%E9%94%99%E8%B7%AF.txt",
        "repo": "sennic/BL",
        "path": "走错路.txt",
    },
]
DANMEI_TITLE_MARKERS = re.compile(
    r"耽美|纯爱|\bBL\b|强受|被迫成受|替身受|总攻|忠犬暗卫受|娘炮拿了攻|教主受|弱受|"
    r"渣攻|疯受|男妻|男主和男主|不是攻|漂亮攻|养弯|攻剧本|双男|主攻|主受",
    flags=re.I,
)

DIMENSION_ORDER = ["外貌", "神态", "动作", "语言", "口头禅", "心理"]
DIMENSION_RULES = OrderedDict(
    [
        (
            "外貌",
            [
                "容貌",
                "相貌",
                "长相",
                "五官",
                "脸",
                "面容",
                "眉眼",
                "眉毛",
                "眼睛",
                "眼眸",
                "眸子",
                "嘴唇",
                "薄唇",
                "头发",
                "长发",
                "身材",
                "身形",
                "身量",
                "肤色",
                "皮肤",
                "穿着",
                "衣着",
                "衣衫",
                "打扮",
                "俊",
                "美",
                "漂亮",
                "清秀",
                "高挑",
            ],
        ),
        (
            "神态",
            [
                "神色",
                "神情",
                "神态",
                "面色",
                "脸色",
                "表情",
                "目光",
                "眼神",
                "眉头",
                "眉梢",
                "嘴角",
                "瞳孔",
                "眸",
                "垂眸",
                "皱眉",
                "抿唇",
                "微笑",
                "冷笑",
                "发怔",
                "愣",
                "惊讶",
                "怒",
                "哭",
            ],
        ),
        (
            "动作",
            [
                "转身",
                "起身",
                "站起",
                "坐下",
                "走去",
                "走进",
                "抬手",
                "伸手",
                "握住",
                "攥",
                "捏",
                "拍",
                "拉住",
                "推开",
                "回头",
                "低头",
                "抬头",
                "俯身",
                "后退",
                "上前",
                "扑",
                "冲",
                "咬牙",
                "点头",
                "摇头",
                "闭上",
                "睁开",
            ],
        ),
        (
            "语言",
            [
                "说",
                "道",
                "问",
                "答",
                "喊",
                "叫",
                "低声",
                "轻声",
                "冷声",
                "沉声",
                "笑道",
                "开口",
                "接话",
                "反问",
            ],
        ),
        (
            "心理",
            [
                "心想",
                "心里",
                "心中",
                "暗想",
                "暗自",
                "暗道",
                "不禁",
                "忍不住",
                "意识到",
                "想到",
                "觉得",
                "感到",
                "担心",
                "害怕",
                "希望",
                "失望",
                "盘算",
                "思量",
                "琢磨",
                "以为",
            ],
        ),
    ]
)

CATCHPHRASE_MARKERS = [
    "我跟你说",
    "不是我说",
    "说真的",
    "你知道吗",
    "没事",
    "放心",
    "行了",
    "算了",
    "好吧",
    "等等",
    "别急",
    "随你",
    "再说",
    "哈哈",
    "呵呵",
    "哼",
    "嗯",
    "喂",
    "啊",
    "呀",
    "嘛",
    "啦",
]

PERSONALITY_RULES = OrderedDict(
    [
        (
            "豪爽侠义型",
            [
                "兄弟",
                "义气",
                "仗义",
                "痛快",
                "爽快",
                "大笑",
                "哈哈",
                "喝酒",
                "干了",
                "替你",
                "路见不平",
                "敞亮",
                "直来直去",
                "抱拳",
                "豪迈",
                "爽朗",
                "干脆",
                "利落",
                "大方",
                "不客气",
                "有话直说",
                "拍桌",
            ],
        ),
        (
            "冷静理智型",
            [
                "冷静",
                "平静",
                "从容",
                "分析",
                "判断",
                "计划",
                "思考",
                "沉着",
                "理智",
                "不动声色",
                "冷静地",
                "有条不紊",
                "权衡",
                "沉思",
                "观察",
                "谨慎",
                "清醒",
                "理清",
                "推断",
                "冷静下来",
            ],
        ),
        (
            "温柔内敛型",
            [
                "温柔",
                "轻声",
                "柔和",
                "心疼",
                "默默",
                "体贴",
                "细心",
                "温暖",
                "忍住",
                "垂眸",
                "轻轻",
                "微笑",
                "安静",
                "心软",
                "温声",
                "耐心",
                "包容",
                "照顾",
                "轻柔",
            ],
        ),
        (
            "活泼开朗型",
            [
                "欢快",
                "兴奋",
                "蹦",
                "眨眼",
                "调皮",
                "开心",
                "嘻嘻",
                "笑嘻嘻",
                "俏皮",
                "活泼",
                "热闹",
                "雀跃",
                "笑",
                "乐",
                "打趣",
                "玩笑",
                "欢笑",
                "撒娇",
                "跳起来",
                "灵动",
                "蹦蹦跳跳",
            ],
        ),
        (
            "阴郁腹黑型",
            [
                "阴沉",
                "冷笑",
                "算计",
                "讥讽",
                "杀意",
                "阴冷",
                "城府",
                "深不可测",
                "眸色深",
                "漠然",
                "阴森",
                "报复",
                "嘲讽",
                "沉默",
                "黯",
                "黑",
                "恨",
                "怨",
                "不语",
                "阴影",
                "苍白",
                "暗暗",
                "深沉",
            ],
        ),
        (
            "霸道强势型",
            [
                "命令",
                "必须",
                "不许",
                "强势",
                "压迫",
                "掌控",
                "霸道",
                "不可置疑",
                "冷声",
                "俯视",
                "威胁",
                "不容拒绝",
                "强行",
                "逼迫",
                "控制",
                "占有",
                "打断",
                "抓住",
                "压住",
                "不容分说",
            ],
        ),
        (
            "天真烂漫型",
            [
                "好奇",
                "天真",
                "懵懂",
                "纯真",
                "睁大",
                "第一次",
                "不知",
                "单纯",
                "欢喜",
                "惊奇",
                "稚气",
                "新鲜",
                "好玩",
                "懵懵懂懂",
                "睁圆",
                "不明白",
                "疑惑",
                "孩子气",
            ],
        ),
        (
            "市侩圆滑型",
            [
                "赔笑",
                "客气",
                "打哈哈",
                "生意",
                "利益",
                "钱",
                "圆场",
                "世故",
                "奉承",
                "见风使舵",
                "讨好",
                "价钱",
                "赔不是",
                "客套",
                "打听",
                "讨价还价",
                "见人说人话",
            ],
        ),
        (
            "高傲冷峻型",
            [
                "高傲",
                "冷峻",
                "淡漠",
                "睥睨",
                "不屑",
                "清冷",
                "疏离",
                "倨傲",
                "漫不经心",
                "矜贵",
                "冷冷",
                "漠视",
                "看不起",
                "无视",
                "不在意",
                "转开目光",
                "孤冷",
                "清淡",
                "高冷",
                "寡淡",
                "孤傲",
                "淡淡",
                "平淡",
                "面无表情",
                "若无其事",
                "无动于衷",
                "轻蔑",
                "不屑一顾",
                "冷着脸",
                "目光淡",
                "目光冷",
                "睨",
                "瞥",
                "抬眼",
                "垂眼",
            ],
        ),
        (
            "热血冲动型",
            [
                "冲上去",
                "怒吼",
                "大喝",
                "咬牙",
                "热血",
                "毫不犹豫",
                "拼命",
                "爆发",
                "战意",
                "拳头",
                "愤怒",
                "冲动",
                "不顾一切",
                "冲",
                "战",
                "怒",
                "吼",
                "拳",
                "刀",
                "剑",
                "血",
                "拼",
                "奋力",
                "火气",
            ],
        ),
    ]
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--per-type", type=int, default=20)
    parser.add_argument(
        "--candidate-pool",
        type=int,
        default=80,
        help="每个题材按热度顺序最多准备多少候选，用于跳过锁章继续补抓",
    )
    parser.add_argument("--chapters", type=int, default=2)
    parser.add_argument("--sleep", type=float, default=0.35)
    parser.add_argument("--keep-cache", action="store_true")
    return parser.parse_args()


def decode_response(data: bytes, content_type: str = "") -> str:
    encodings = []
    match = re.search(r"charset\s*=\s*([\w-]+)", content_type or "", re.I)
    if match:
        encodings.append(match.group(1))
    encodings.extend(["utf-8", "gb18030", "gbk"])
    for encoding in encodings:
        try:
            return data.decode(encoding)
        except (LookupError, UnicodeDecodeError):
            continue
    return data.decode("utf-8", errors="replace")


class Fetcher:
    def __init__(self, delay: float):
        self.delay = delay
        self.last_request = 0.0

    def _wait(self) -> None:
        elapsed = time.monotonic() - self.last_request
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)

    def get(self, url: str, cache_name: str) -> str:
        CACHE_DIR.mkdir(exist_ok=True)
        cache_path = CACHE_DIR / cache_name
        if cache_path.exists() and cache_path.stat().st_size > 0:
            return cache_path.read_text(encoding="utf-8")

        last_error = None
        for attempt in range(1, 5):
            self._wait()
            request = urllib.request.Request(url, headers=REQUEST_HEADERS)
            try:
                with urllib.request.urlopen(request, timeout=35, context=SSL_CONTEXT) as response:
                    raw = response.read()
                    content_encoding = (response.headers.get("Content-Encoding") or "").lower()
                    content_type = response.headers.get("Content-Type") or ""
                if content_encoding == "gzip":
                    import gzip

                    raw = gzip.decompress(raw)
                text = decode_response(raw, content_type)
                cache_path.write_text(text, encoding="utf-8")
                self.last_request = time.monotonic()
                return text
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
                last_error = exc
                self.last_request = time.monotonic()
                if attempt < 4:
                    time.sleep(1.5 * attempt)
        raise RuntimeError(f"fetch failed: {url}: {last_error}")


def clean_html_fragment(fragment: str) -> str:
    fragment = html.unescape(fragment)
    fragment = re.sub(r"<script\b[^>]*>.*?</script>", "", fragment, flags=re.I | re.S)
    fragment = re.sub(r"<style\b[^>]*>.*?</style>", "", fragment, flags=re.I | re.S)
    fragment = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    fragment = re.sub(r"</p\s*>", "\n", fragment, flags=re.I)
    fragment = re.sub(r"<[^>]+>", "", fragment)
    fragment = fragment.replace("\xa0", " ").replace("\r", "")
    return re.sub(r"[ \t]+", " ", fragment).strip()


def extract_title_author(index_html: str, fallback_title: str) -> tuple[str, str]:
    match = re.search(r"<title[^>]*>(.*?)</title>", index_html, flags=re.I | re.S)
    title = clean_html_fragment(match.group(1)) if match else fallback_title
    title = re.sub(r"\s*[\^|_].*?晋江文学城.*$", "", title).strip()
    title = re.sub(r"\s+晋江文学城.*$", "", title).strip()
    title_match = re.search(r"《([^》]+)》", title)
    work_title = f"《{title_match.group(1)}》" if title_match else fallback_title
    author = "未知作者"
    if title_match:
        tail = title[title_match.end() :].strip(" _　")
        if tail:
            author = re.split(r"[\^|_]", tail, maxsplit=1)[0].strip() or author
    return work_title, author


def chapter_ids(index_html: str) -> list[int]:
    found = re.findall(r"clickchapterid\s*=\s*[\"'](\d+)", index_html, flags=re.I)
    found.extend(re.findall(r"chapterid\s*=\s*(\d+)", index_html, flags=re.I))
    return sorted({int(item) for item in found if int(item) > 0})


def extract_body(chapter_html: str) -> str:
    patterns = [
        r'id=["\']paragraph_comment_content["\'][^>]*>(.*?)</div>',
        r'class=["\'][^"\']*noveltext[^"\']*["\'][^>]*>(.*?)</div>',
    ]
    for pattern in patterns:
        match = re.search(pattern, chapter_html, flags=re.I | re.S)
        if match:
            body = clean_html_fragment(match.group(1))
            if len(re.sub(r"\s", "", body)) >= 80:
                return body
    return ""


def load_candidates(candidate_pool: int) -> tuple[list[dict], list[dict]]:
    data = json.loads(CANDIDATE_FILE.read_text(encoding="utf-8"))
    all_by_id = {}
    all_candidates = []
    for values in data.values():
        for item in values or []:
            novel_id = int(item["novelid"])
            if novel_id not in all_by_id:
                normalized = dict(item)
                normalized["novelid"] = novel_id
                all_by_id[novel_id] = normalized
                all_candidates.append(normalized)

    assignments = []
    source_by_id = {}
    for public_name, source_name in PUBLIC_GENRES:
        if public_name == "耽美":
            selected = []
            selected_ids = set()
            for github_source in DANMEI_GITHUB_SOURCES:
                if len(selected) >= candidate_pool:
                    break
                selected.append(
                    {
                        "novelid": github_source["novelid"],
                        "title": github_source["title"],
                        "source_kind": "github",
                        "source_url": github_source["url"],
                        "repo": github_source["repo"],
                        "path": github_source["path"],
                    }
                )
            for novel_id in DANMEI_IDS:
                selected.append(all_by_id.get(novel_id, {"novelid": novel_id, "title": ""}))
                selected_ids.add(novel_id)
            for candidate in all_candidates:
                if len(selected) >= candidate_pool:
                    break
                novel_id = int(candidate["novelid"])
                if novel_id in selected_ids:
                    continue
                if DANMEI_TITLE_MARKERS.search(candidate.get("title", "")):
                    selected.append(candidate)
                    selected_ids.add(novel_id)
        else:
            selected = list(data.get(source_name, []) or [])[:candidate_pool]
        selected = selected[:candidate_pool]
        for rank, candidate in enumerate(selected, start=1):
            novel_id = int(candidate["novelid"])
            title = candidate.get("title", "")
            assignments.append(
                {
                    "genre": public_name,
                    "rank": rank,
                    "novelid": novel_id,
                    "candidate_title": title,
                }
            )
            source = source_by_id.setdefault(
                novel_id,
                {
                    "novelid": novel_id,
                    "candidate_title": title,
                    "genres": [],
                    "ranks": {},
                    "source_kind": candidate.get("source_kind", "jjwxc"),
                    "source_url": candidate.get("source_url", ""),
                    "repo": candidate.get("repo", ""),
                    "path": candidate.get("path", ""),
                },
            )
            if public_name not in source["genres"]:
                source["genres"].append(public_name)
            source["ranks"][public_name] = rank
    return assignments, list(source_by_id.values())


def load_previous_sources() -> dict[int, dict]:
    if not OUTPUT_MANIFEST.exists():
        return {}
    try:
        manifest = json.loads(OUTPUT_MANIFEST.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    previous = {}
    for source in manifest.get("sources", []):
        if source.get("status") == "ok":
            previous[int(source["novelid"])] = source
    return previous


def load_previous_statuses() -> dict[int, str]:
    if not OUTPUT_MANIFEST.exists():
        return {}
    try:
        manifest = json.loads(OUTPUT_MANIFEST.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        int(source["novelid"]): source.get("status", "")
        for source in manifest.get("sources", [])
        if "novelid" in source
    }


def merge_previous_source(source: dict, previous: dict) -> dict:
    reused = dict(previous)
    reused["candidate_title"] = source.get("candidate_title") or reused.get("candidate_title", "")
    reused["genres"] = list(source.get("genres", []))
    reused["ranks"] = dict(source.get("ranks", {}))
    return reused


def effective_assignments(
    assignments: list[dict], sources: list[dict], per_type: int
) -> list[dict]:
    source_by_id = {int(source["novelid"]): source for source in sources}
    selected = []
    for genre, _ in PUBLIC_GENRES:
        count = 0
        seen = set()
        for assignment in assignments:
            if assignment["genre"] != genre:
                continue
            novel_id = int(assignment["novelid"])
            source = source_by_id.get(novel_id)
            if novel_id in seen or not source or source.get("status") != "ok":
                continue
            selected.append(assignment)
            seen.add(novel_id)
            count += 1
            if count >= per_type:
                break
    return selected


def fetch_source(fetcher: Fetcher, source: dict, chapters_wanted: int) -> dict:
    novel_id = source["novelid"]
    index_url = source.get("source_url") or BOOK_URL.format(novelid=novel_id)
    result = dict(source)
    result.update(
        {
            "url": index_url,
            "status": "failed",
            "work_title": source.get("candidate_title") or f"作品 {novel_id}",
            "author": "未知作者",
            "chapters": [],
            "sample_chars": 0,
            "sample_sha256": "",
            "error": "",
        }
    )
    try:
        if source.get("source_kind") == "github":
            raw_text = fetcher.get(index_url, f"github_{abs(novel_id)}.txt")
            raw_text = html.unescape(raw_text).replace("\r", "").strip()
            if len(re.sub(r"\s", "", raw_text)) < 80:
                raise RuntimeError("GitHub 文本样本过短")
            sample = raw_text[:60000]
            result["work_title"] = f"《{source.get('candidate_title', '未命名')}》"
            result["author"] = f"GitHub/{source.get('repo', 'unknown')}"
            result["status"] = "ok"
            result["chapters"] = [
                {
                    "chapterid": "sample",
                    "url": index_url,
                    "chars": len(sample),
                    "sha256": hashlib.sha256(sample.encode("utf-8")).hexdigest(),
                    "text": sample,
                }
            ]
            result["sample_chars"] = len(sample)
            result["sample_sha256"] = hashlib.sha256(sample.encode("utf-8")).hexdigest()
            return result

        index_html = fetcher.get(index_url, f"{novel_id}_index.html")
        work_title, author = extract_title_author(index_html, result["work_title"])
        result["work_title"] = work_title
        result["author"] = author
        ids = chapter_ids(index_html)
        if not ids:
            raise RuntimeError("目录页没有发现公开章节 ID")
        bodies = []
        for chapter_id in ids[: min(len(ids), 8)]:
            chapter_url = CHAPTER_URL.format(novelid=novel_id, chapterid=chapter_id)
            chapter_html = fetcher.get(chapter_url, f"{novel_id}_{chapter_id}.html")
            body = extract_body(chapter_html)
            if len(re.sub(r"\s", "", body)) < 80:
                continue
            bodies.append(
                {
                    "chapterid": chapter_id,
                    "url": chapter_url,
                    "text": body,
                }
            )
            if len(bodies) >= chapters_wanted:
                break
        if not bodies:
            raise RuntimeError("目录页可见章节未提取到正文")
        combined = "\n\n".join(item["text"] for item in bodies)
        result["status"] = "ok"
        result["chapters"] = [
            {
                "chapterid": item["chapterid"],
                "url": item["url"],
                "chars": len(item["text"]),
                "sha256": hashlib.sha256(item["text"].encode("utf-8")).hexdigest(),
                "text": item["text"],
            }
            for item in bodies
        ]
        result["sample_chars"] = len(combined)
        result["sample_sha256"] = hashlib.sha256(combined.encode("utf-8")).hexdigest()
    except Exception as exc:  # keep one unavailable source from stopping the run
        result["error"] = str(exc)
    return result


def split_segments(text: str) -> list[str]:
    segments = []
    for line in re.split(r"\n+", text):
        line = re.sub(r"\s+", " ", line).strip()
        if not line or re.match(r"^(第[零一二三四五六七八九十百千万0-9]+章|番外|作者有话)", line):
            continue
        pieces = re.split(r"(?<=[。！？；])", line)
        for piece in pieces:
            piece = piece.strip()
            if len(piece) < 15:
                continue
            while len(piece) > 320:
                split_at = max(piece.rfind("，", 80, 320), piece.rfind("。", 80, 320))
                if split_at < 80:
                    split_at = 300
                segments.append(piece[: split_at + 1].strip())
                piece = piece[split_at + 1 :].strip()
            if len(piece) >= 15:
                segments.append(piece)
    return segments


def detect_dimensions(segment: str) -> list[str]:
    result = []
    language_hit = bool(
        re.search(r"[“‘『「].{1,160}[”’』」]", segment)
        or re.search(r"(?:说|道|问|答|喊|叫|开口|低声|轻声|冷声|沉声|笑道)", segment)
    )
    for dimension, markers in DIMENSION_RULES.items():
        if any(marker in segment for marker in markers):
            result.append(dimension)
    if language_hit and "语言" not in result:
        result.append("语言")
    if "语言" in result and (
        any(marker in segment for marker in CATCHPHRASE_MARKERS)
        or re.search(r"[啊呀嘛啦哎呵哼嗯喂！?？]", segment)
        or len(segment) <= 45
    ):
        result.append("口头禅")
    return [dimension for dimension in DIMENSION_ORDER if dimension in result]


def classify_personality(segment: str) -> tuple[str | None, list[str], int]:
    scores = []
    for personality, markers in PERSONALITY_RULES.items():
        hits = [marker for marker in markers if marker in segment]
        scores.append((len(hits), personality, hits))
    score, personality, hits = max(scores, key=lambda item: item[0])
    if score == 0:
        return None, [], 0
    return personality, hits, score


def make_records(sources: list[dict]) -> list[dict]:
    records = []
    sequence = 0
    for source in sources:
        if source["status"] != "ok":
            continue
        for chapter in source["chapters"]:
            for segment in split_segments(chapter["text"]):
                dimensions = detect_dimensions(segment)
                personality, signals, score = classify_personality(segment)
                if not dimensions or personality is None:
                    continue
                sequence += 1
                records.append(
                    {
                        "sequence": sequence,
                        "novelid": source["novelid"],
                        "work_title": source["work_title"],
                        "author": source["author"],
                        "genres": source["genres"],
                        "chapterid": chapter["chapterid"],
                        "source_url": chapter["url"],
                        "text": segment,
                        "dimensions": dimensions,
                        "personality": personality,
                        "signals": signals,
                        "score": score,
                    }
                )
    return records


def choose_records(records: list[dict], personality: str) -> dict[str, list[dict]]:
    by_dimension = {
        dimension: [
            record
            for record in records
            if record["personality"] == personality and dimension in record["dimensions"]
        ]
        for dimension in DIMENSION_ORDER
    }
    for values in by_dimension.values():
        values.sort(key=lambda record: (record["novelid"], record["sequence"]))

    chosen: dict[str, list[dict]] = {dimension: [] for dimension in DIMENSION_ORDER}
    used = set()
    # Keep each section varied across books while first reaching a useful size.
    for dimension in DIMENSION_ORDER:
        buckets = defaultdict(list)
        for record in by_dimension[dimension]:
            buckets[record["novelid"]].append(record)
        keys = list(buckets)
        cursor = 0
        chars = 0
        while keys and chars < 2200:
            key = keys[cursor % len(keys)]
            record = buckets[key].pop(0)
            chosen[dimension].append(record)
            used.add((record["sequence"], dimension))
            chars += len(record["text"])
            if not buckets[key]:
                keys.remove(key)
                if not keys:
                    break
            else:
                cursor += 1

    total_chars = sum(len(record["text"]) for values in chosen.values() for record in values)
    if total_chars < 10000:
        remaining = []
        for dimension, values in by_dimension.items():
            for record in values:
                key = (record["sequence"], dimension)
                if key not in used:
                    remaining.append((dimension, record))
        remaining.sort(key=lambda item: (item[1]["novelid"], item[1]["sequence"]))
        for dimension, record in remaining:
            chosen[dimension].append(record)
            total_chars += len(record["text"])
            if total_chars >= 12000:
                break
    return chosen


def render_source_line(record: dict) -> str:
    genre_text = "、".join(record["genres"])
    return (
        f"> 题材：{genre_text}；第 {record['chapterid']} 章；"
        f"[原文定位]({record['source_url']})；规则信号：{ '、'.join(record['signals']) }"
    )


def render_markdown(
    assignments: list[dict],
    sources: list[dict],
    records: list[dict],
    per_type: int,
) -> tuple[str, dict]:
    source_by_id = {source["novelid"]: source for source in sources}
    successful = [source for source in sources if source["status"] == "ok"]
    unique_books = len({source["novelid"] for source in successful})
    lines = [
        "# 人物描写库（真实抓取样本版）",
        "",
        "> 本文档中的引文来自来源清单所列的实际章节页面，构建过程没有让 AI 改写或补写原文。",
        "> 仅做章节样本抽取、去除页面噪声、规则化标签和分组；性格标签是词法规则推断，不等于作者对角色的官方设定。",
        "> 授权依据：按用户提供的授权说明使用所列来源。使用前请继续遵守原作者、平台和授权协议的转载范围。",
        "",
        "## 使用说明",
        "",
        "- 六个描写维度：外貌、神态、动作、语言、口头禅/高频语气、心理。",
        "- “口头禅”是基于重复语气词、短对白和高频表达标记的样本，若需角色级口头禅，应结合全书复核。",
        "- 题材覆盖和作品热度顺序来自 `types_novels.json` 的候选顺序；每条样本都保留作品 ID、章节和原文链接。",
        "",
        "## 覆盖统计",
        "",
        "| 题材 | 计划作品数 | 成功抓取作品数 | 去重后作品数 | 说明 |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    genre_stats = {}
    for genre, _ in PUBLIC_GENRES:
        planned = [item for item in assignments if item["genre"] == genre]
        done = [item for item in planned if source_by_id[item["novelid"]]["status"] == "ok"]
        genre_books = {item["novelid"] for item in done}
        note = f"达到 {per_type} 部" if len(genre_books) >= per_type else "来源不足或抓取失败，需补源"
        lines.append(f"| {genre} | {per_type} | {len(done)} | {len(genre_books)} | {note} |")
        genre_stats[genre] = {
            "target_books": per_type,
            "successful_assignments": len(done),
            "successful_books": len(genre_books),
        }

    lines.extend(
        [
            "",
            f"> 当前实际成功抓取：{unique_books} 部去重作品；有效规则样本：{len(records)} 条。",
            "",
            "## 题材作品清单",
            "",
            "以下清单只列入实际成功抓取并进入本库的作品；题材之间允许同一本作品交叉归类。",
            "",
        ]
    )
    for genre, _ in PUBLIC_GENRES:
        genre_assignments = [item for item in assignments if item["genre"] == genre]
        lines.extend([f"### {genre}（{len(genre_assignments)} 部）", ""])
        for item in genre_assignments:
            source = source_by_id[item["novelid"]]
            lines.append(
                f"{item['rank']}. **{source['work_title']}**（{source['author']}，"
                f"ID `{source['novelid']}`，候选顺位 {item['rank']}）"
            )
        lines.append("")

    lines.extend(
        [
            "## 来源索引",
            "",
            "详细来源、抓取状态、章节哈希和失败原因见 `人物描写素材库_来源清单.json`。以下列出本库实际抓取成功的作品：",
            "",
        ]
    )
    for source in successful:
        lines.append(
            f"- **{source['work_title']}**（{source['author']}，ID `{source['novelid']}`，"
            f"题材：{'、'.join(source['genres'])}，样本 {source['sample_chars']} 字，"
            f"SHA-256 `{source['sample_sha256'][:16]}…`）"
        )

    personality_stats = {}
    for personality in PERSONALITY_RULES:
        selected = choose_records(records, personality)
        char_count = sum(len(record["text"]) for values in selected.values() for record in values)
        personality_stats[personality] = {
            "chars_rendered": char_count,
            "records_rendered": sum(len(values) for values in selected.values()),
            "dimensions": {dimension: len(selected[dimension]) for dimension in DIMENSION_ORDER},
            "meets_10000_chars": char_count >= 10000,
        }
        lines.extend(
            [
                "",
                f"## {personality}",
                "",
                f"> 本类规则化样本：{personality_stats[personality]['records_rendered']} 条，约 {char_count} 字。",
            ]
        )
        for dimension in DIMENSION_ORDER:
            lines.extend(["", f"### {dimension}", ""])
            values = selected[dimension]
            if not values:
                lines.append("> 当前样本不足，未用生成内容补齐。")
                continue
            for index, record in enumerate(values, start=1):
                lines.extend(
                    [
                        f"**{index}. {record['work_title']} · {record['author']}**",
                        render_source_line(record),
                        f"> {record['text']}",
                        "",
                    ]
                )

    stats = {
        "unique_successful_books": unique_books,
        "successful_source_count": len(successful),
        "records": len(records),
        "genre": genre_stats,
        "personality": personality_stats,
    }
    return "\n".join(lines).rstrip() + "\n", stats


def main() -> None:
    args = parse_args()
    if not CANDIDATE_FILE.exists():
        raise SystemExit(f"missing candidate file: {CANDIDATE_FILE}")

    assignments, source_pool = load_candidates(args.candidate_pool)
    print(f"assignments={len(assignments)} unique_sources={len(source_pool)}")
    fetcher = Fetcher(args.sleep)
    previous_sources = load_previous_sources()
    previous_statuses = load_previous_statuses()
    fetched_sources = []
    successful_by_genre = defaultdict(int)
    attempted_ids = set()

    for index, source in enumerate(source_pool, start=1):
        needed_genres = [
            genre
            for genre in source["genres"]
            if successful_by_genre[genre] < args.per_type
        ]
        if not needed_genres:
            continue
        novel_id = int(source["novelid"])
        if novel_id in attempted_ids:
            continue
        attempted_ids.add(novel_id)
        if novel_id in previous_sources:
            fetched = merge_previous_source(source, previous_sources[novel_id])
            reused = "reused"
        elif previous_statuses.get(novel_id) == "failed":
            fetched = dict(source)
            fetched.update(
                {
                    "url": source.get("source_url") or BOOK_URL.format(novelid=novel_id),
                    "status": "failed",
                    "work_title": source.get("candidate_title") or f"作品 {novel_id}",
                    "author": "未知作者",
                    "chapters": [],
                    "sample_chars": 0,
                    "sample_sha256": "",
                    "error": "上一轮已确认不可访问，本轮跳过重复请求",
                }
            )
            reused = "skipped"
        else:
            fetched = fetch_source(fetcher, source, args.chapters)
            reused = fetched["status"]
        fetched_sources.append(fetched)
        if fetched["status"] == "ok":
            for genre in source["genres"]:
                if successful_by_genre[genre] < args.per_type:
                    successful_by_genre[genre] += 1
        status = fetched["status"]
        print(
            f"[{index}/{len(source_pool)}] {reused} {status} {fetched['novelid']} "
            f"{fetched['work_title']} chars={fetched['sample_chars']}"
        )
        if all(successful_by_genre[genre] >= args.per_type for genre, _ in PUBLIC_GENRES):
            break

    selected_assignments = effective_assignments(assignments, fetched_sources, args.per_type)
    records = make_records(fetched_sources)
    markdown, stats = render_markdown(selected_assignments, fetched_sources, records, args.per_type)
    OUTPUT_MD.write_text(markdown, encoding="utf-8")
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "authorization_basis": "user-provided authorization statement",
        "source_policy": "sample chapters only; source URL, chapter ID and SHA-256 retained",
        "classification": "rule-based lexical tagging; no AI rewriting",
        "candidate_pool_size": args.candidate_pool,
        "candidate_pool_assignments": assignments,
        "assignments": selected_assignments,
        "sources": fetched_sources,
        "attempted_source_count": len(fetched_sources),
        "stats": stats,
    }
    OUTPUT_MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    if not args.keep_cache:
        shutil.rmtree(CACHE_DIR, ignore_errors=True)
    print(f"written={OUTPUT_MD}")
    print(f"manifest={OUTPUT_MANIFEST}")
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
