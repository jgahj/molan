import glob
import sys
import os
import re
import time

sys.stdout.reconfigure(encoding='utf-8')

RE_DIVIDER = re.compile(r'^-{6,}\s*$', re.M)

RE_VOLUME = re.compile(
    r'^[ \t\u3000\uFEFF]*第\s*[0-9一二三四五六七八九十百千万两零〇]+\s*卷[^\r\n]{0,50}$'
)

RE_CHAPTER_HEADING = re.compile(
    r'^[ \t\u3000\uFEFF]*(?:'
    r'第\s*[0-9一二三四五六七八九十百千万两零〇]+\s*[章回节篇话折][^\r\n]{0,80}|'
    r'Chapter\s*\d+[^\r\n]{0,80}|'
    r'【\s*\d{1,4}\s*】[^\r\n]{0,80}|'
    r'\d{1,4}\s*[.、，:：\s\-–—]\s*[\u4e00-\u9fa5a-zA-Z][^\r\n]{0,80}|'
    r'(?:引子|序章?|楔子|尾声|大结局|终章|后记|结语|番外(?:[篇章\d\s]|$)|上架感言)[^\r\n]{0,80}'
    r')[ \t\u3000]*$',
    re.M
)

def extract_chapters_from_text(text):
    """
    Extracts chapters as a list of dicts:
    [{'start': int, 'end': int, 'title': str}]
    and returns (preamble_text, chapters)
    """
    div_matches = list(RE_DIVIDER.finditer(text))
    
    # 1. Shukuge divider format
    if len(div_matches) >= 5:
        raw_sections = []
        for i in range(len(div_matches)):
            start = div_matches[i].start()
            end = div_matches[i+1].start() if i+1 < len(div_matches) else len(text)
            content = text[start:end]
            lines = [l.strip() for l in content.split('\n') if l.strip()]
            title = lines[1] if len(lines) > 1 else (lines[0] if lines else '')
            raw_sections.append({'start': start, 'end': end, 'title': title, 'length': len(content.strip())})
        
        chapters = []
        pending_prefix_start = None
        for sec in raw_sections:
            if sec['length'] < 150 and RE_VOLUME.match(sec['title']):
                if pending_prefix_start is None:
                    pending_prefix_start = sec['start']
                continue
            
            s = pending_prefix_start if pending_prefix_start is not None else sec['start']
            pending_prefix_start = None
            chapters.append({'start': s, 'end': sec['end'], 'title': sec['title']})
        
        if pending_prefix_start is not None and chapters:
            chapters[-1]['end'] = len(text)
            
        preamble = text[:chapters[0]['start']] if chapters else ''
        return preamble, chapters

    # 2. Heading regex format
    matches = list(RE_CHAPTER_HEADING.finditer(text))
    if len(matches) >= 5:
        # Filter TOC at start if matches are clustered too tightly (< 100 chars apart)
        start_idx = 0
        if len(matches) > 10:
            for i in range(min(len(matches)-1, 30)):
                if matches[i+1].start() - matches[i].start() < 100:
                    start_idx = i + 1
            if start_idx <= 5:
                start_idx = 0
        
        valid_matches = matches[start_idx:]
        chapters = []
        for i in range(len(valid_matches)):
            start = valid_matches[i].start()
            end = valid_matches[i+1].start() if i+1 < len(valid_matches) else len(text)
            title = valid_matches[i].group().strip()
            chapters.append({'start': start, 'end': end, 'title': title})
            
        preamble = text[:chapters[0]['start']] if chapters else ''
        return preamble, chapters

    # 3. Fallback: single chapter
    return '', [{'start': 0, 'end': len(text), 'title': 'Full'}]

def simplify_content(text):
    preamble, chapters = extract_chapters_from_text(text)
    n = len(chapters)
    if n <= 60:
        return text, n, n, False
    
    first_start = chapters[0]['start']
    first_end = chapters[19]['end']
    
    mid_idx = (n - 20) // 2
    mid_start = chapters[mid_idx]['start']
    mid_end = chapters[mid_idx + 19]['end']
    
    last_start = chapters[n - 20]['start']
    last_end = chapters[n - 1]['end']
    
    parts = []
    if preamble.strip():
        parts.append(preamble.strip())
    parts.append(text[first_start:first_end].strip())
    parts.append(text[mid_start:mid_end].strip())
    parts.append(text[last_start:last_end].strip())
    
    simplified = '\n\n'.join(parts) + '\n'
    return simplified, n, 60, True

def process_corpus(root, dry_run=False):
    files = glob.glob(os.path.join(root, '**', '*.txt'), recursive=True)
    print(f"=== {'DRY-RUN: ' if dry_run else ''}Processing {len(files)} books in '{root}' ===")
    
    t0 = time.time()
    total_orig_bytes = 0
    total_new_bytes = 0
    simplified_count = 0
    intact_count = 0
    errors = []
    
    for idx, f in enumerate(files, 1):
        try:
            with open(f, 'r', encoding='utf-8', errors='ignore') as fp:
                orig_text = fp.read()
            
            orig_len = len(orig_text.encode('utf-8'))
            total_orig_bytes += orig_len
            
            simplified, orig_chaps, kept_chaps, modified = simplify_content(orig_text)
            new_len = len(simplified.encode('utf-8'))
            total_new_bytes += new_len
            
            if modified:
                simplified_count += 1
                if not dry_run:
                    tmp_file = f + '.tmp'
                    with open(tmp_file, 'w', encoding='utf-8') as fp:
                        fp.write(simplified)
                    os.replace(tmp_file, f)
            else:
                intact_count += 1
                
            if idx % 100 == 0 or idx == len(files):
                print(f"[{idx}/{len(files)}] Processed... Simplified: {simplified_count}, Intact: {intact_count}")
        except Exception as e:
            errors.append((f, str(e)))
            print(f"ERROR on {f}: {e}")
            
    elapsed = time.time() - t0
    orig_mb = total_orig_bytes / (1024 * 1024)
    new_mb = total_new_bytes / (1024 * 1024)
    saved_mb = orig_mb - new_mb
    ratio = (total_new_bytes / total_orig_bytes * 100) if total_orig_bytes else 100
    
    print("\n=== SUMMARY ===")
    print(f"Time elapsed: {elapsed:.2f}s")
    print(f"Total files: {len(files)}")
    print(f"Simplified (>60 chaps): {simplified_count}")
    print(f"Intact (<=60 chaps): {intact_count}")
    print(f"Original size: {orig_mb:.2f} MB")
    print(f"New size: {new_mb:.2f} MB ({ratio:.1f}% of original)")
    print(f"Space saved: {saved_mb:.2f} MB")
    print(f"Errors: {len(errors)}")
    return errors

if __name__ == '__main__':
    dry_run = '--dry-run' in sys.argv
    corpus_root = r'资源库/小说原本'
    process_corpus(corpus_root, dry_run=dry_run)
