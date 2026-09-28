/**
 * 墨阑 · 去 AI 味文本对比工具组件 (Diffchecker)
 * 纯原生零依赖，对标 Diffchecker 专业对比体验：
 * 1. CJK 汉字与英文单词细粒度分词与 LCS 差异比对
 * 2. 动态规划行/段落智能对齐（处理增、删、改行并展示占位留白）
 * 3. 并排对比 (Split view) 与单栏合并 (Unified view) 自由切换
 * 4. 统计栏（字数变化、增减量、删除/新增处数）
 * 5. 复制改写后全文及返回工作台平滑还原
 */
(function (global) {
  'use strict';

  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 中英文混合细粒度分词
   * - 单个 CJK 汉字 / 扩展区独立分词
   * - 连续英文字符与数字作为整体单词
   * - 换行、空白和标点单独成 Token
   */
  function tokenize(text) {
    if (!text) return [];
    var tokens = [];
    var regex = /[\u4e00-\u9fa5\u3400-\u4dbf\uf900-\ufaff]|[\w]+|[^\w\s\u4e00-\u9fa5\u3400-\u4dbf\uf900-\ufaff]|\s+/g;
    var match;
    while ((match = regex.exec(text)) !== null) {
      tokens.push(match[0]);
    }
    return tokens;
  }

  /**
   * 计算字符级 Jaccard 相似度（用于行对齐启发式打分）
   */
  function charSimilarity(a, b) {
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    var setA = Object.create(null);
    for (var i = 0; i < a.length; i++) setA[a[i]] = true;
    var common = 0;
    for (var j = 0; j < b.length; j++) {
      if (setA[b[j]]) common++;
    }
    return (2 * common) / (a.length + b.length);
  }

  /**
   * 基于 LCS 动态规划提取 Token 级差异
   * 输出格式：[{ type: 'eq'|'del'|'add', val: string }, ...]
   */
  function lcsTokenDiff(tokensA, tokensB) {
    var n = tokensA.length, m = tokensB.length;
    if (n === 0 && m === 0) return [];
    if (n === 0) return [{ type: 'add', val: tokensB.join('') }];
    if (m === 0) return [{ type: 'del', val: tokensA.join('') }];

    var dp = [];
    for (var i = 0; i <= n; i++) {
      dp.push(new Uint16Array(m + 1));
    }

    for (var i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        if (tokensA[i] === tokensB[j]) {
          dp[i][j] = dp[i + 1][j + 1] + 1;
        } else {
          dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
        }
      }
    }

    var result = [];
    var i = 0, j = 0;
    while (i < n && j < m) {
      if (tokensA[i] === tokensB[j]) {
        result.push({ type: 'eq', val: tokensA[i] });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        result.push({ type: 'del', val: tokensA[i] });
        i++;
      } else {
        result.push({ type: 'add', val: tokensB[j] });
        j++;
      }
    }
    while (i < n) { result.push({ type: 'del', val: tokensA[i++] }); }
    while (j < m) { result.push({ type: 'add', val: tokensB[j++] }); }

    // 合并相邻同类型 Token 提高渲染性能
    var merged = [];
    for (var k = 0; k < result.length; k++) {
      var cur = result[k];
      if (merged.length > 0 && merged[merged.length - 1].type === cur.type) {
        merged[merged.length - 1].val += cur.val;
      } else {
        merged.push({ type: cur.type, val: cur.val });
      }
    }
    return merged;
  }

  /**
   * 行/段对齐算法
   * 将原文 linesA 与改写后 linesB 对齐成数组：
   * [{ type: 'eq'|'mod'|'del'|'add', a: string, b: string, lineA: number|null, lineB: number|null }]
   */
  function alignLines(linesA, linesB) {
    var n = linesA.length, m = linesB.length;
    if (n === m) {
      var simpleAligned = [];
      for (var k = 0; k < n; k++) {
        var isEq = linesA[k] === linesB[k];
        simpleAligned.push({
          type: isEq ? 'eq' : 'mod',
          a: linesA[k],
          b: linesB[k],
          lineA: k + 1,
          lineB: k + 1
        });
      }
      return simpleAligned;
    }

    var dp = [];
    var path = [];
    for (var i = 0; i <= n; i++) {
      dp.push(new Float32Array(m + 1));
      path.push(new Uint8Array(m + 1)); // 0: diag, 1: del A, 2: add B
    }

    for (var i = 1; i <= n; i++) dp[i][0] = -0.5 * i;
    for (var j = 1; j <= m; j++) dp[0][j] = -0.5 * j;

    for (var i = 1; i <= n; i++) {
      for (var j = 1; j <= m; j++) {
        var a = linesA[i - 1], b = linesB[j - 1];
        var sim = charSimilarity(a, b);
        var matchScore = (a === b) ? 2.0 : (sim >= 0.2 ? sim * 1.6 : -0.9);
        var scoreDiag = dp[i - 1][j - 1] + matchScore;
        var scoreDel = dp[i - 1][j] - 0.45;
        var scoreAdd = dp[i][j - 1] - 0.45;

        if (scoreDiag >= scoreDel && scoreDiag >= scoreAdd) {
          dp[i][j] = scoreDiag;
          path[i][j] = 0;
        } else if (scoreDel >= scoreAdd) {
          dp[i][j] = scoreDel;
          path[i][j] = 1;
        } else {
          dp[i][j] = scoreAdd;
          path[i][j] = 2;
        }
      }
    }

    var aligned = [];
    var currI = n, currJ = m;
    while (currI > 0 || currJ > 0) {
      if (currI > 0 && currJ > 0 && path[currI][currJ] === 0) {
        var strA = linesA[currI - 1], strB = linesB[currJ - 1];
        aligned.unshift({
          type: strA === strB ? 'eq' : 'mod',
          a: strA,
          b: strB,
          lineA: currI,
          lineB: currJ
        });
        currI--; currJ--;
      } else if (currI > 0 && (currJ === 0 || path[currI][currJ] === 1)) {
        aligned.unshift({
          type: 'del',
          a: linesA[currI - 1],
          b: '',
          lineA: currI,
          lineB: null
        });
        currI--;
      } else {
        aligned.unshift({
          type: 'add',
          a: '',
          b: linesB[currJ - 1],
          lineA: null,
          lineB: currJ
        });
        currJ--;
      }
    }
    return aligned;
  }

  /**
   * 统计改动数据
   */
  function computeStats(aligned, originalText, revisedText) {
    var origChars = (originalText || '').length;
    var revChars = (revisedText || '').length;
    var charDiff = revChars - origChars;
    var delCount = 0;
    var addCount = 0;
    var modLines = 0;
    var eqLines = 0;

    for (var i = 0; i < aligned.length; i++) {
      var item = aligned[i];
      if (item.type === 'eq') {
        eqLines++;
      } else if (item.type === 'mod') {
        modLines++;
        var diff = lcsTokenDiff(tokenize(item.a), tokenize(item.b));
        for (var k = 0; k < diff.length; k++) {
          if (diff[k].type === 'del') delCount++;
          if (diff[k].type === 'add') addCount++;
        }
      } else if (item.type === 'del') {
        delCount++;
      } else if (item.type === 'add') {
        addCount++;
      }
    }

    return {
      origChars: origChars,
      revChars: revChars,
      charDiff: charDiff,
      delCount: delCount,
      addCount: addCount,
      modLines: modLines,
      eqLines: eqLines,
      totalLines: aligned.length
    };
  }

  /**
   * 渲染修改行的行内差异 HTML
   */
  function renderLineDiff(item) {
    if (item.type === 'eq') {
      return {
        left: esc(item.a),
        right: esc(item.b)
      };
    }
    if (item.type === 'del') {
      return {
        left: '<del class="mdc-del">' + esc(item.a) + '</del>',
        right: ''
      };
    }
    if (item.type === 'add') {
      return {
        left: '',
        right: '<ins class="mdc-ins">' + esc(item.b) + '</ins>'
      };
    }
    // mod: 执行行内细粒度 token diff
    var diff = lcsTokenDiff(tokenize(item.a), tokenize(item.b));
    var leftHtml = '', rightHtml = '';
    for (var k = 0; k < diff.length; k++) {
      var d = diff[k];
      if (d.type === 'eq') {
        var text = esc(d.val);
        leftHtml += text;
        rightHtml += text;
      } else if (d.type === 'del') {
        leftHtml += '<del class="mdc-del">' + esc(d.val) + '</del>';
      } else if (d.type === 'add') {
        rightHtml += '<ins class="mdc-ins">' + esc(d.val) + '</ins>';
      }
    }
    return { left: leftHtml, right: rightHtml };
  }

  /**
   * 渲染并排对比 (Split View)
   */
  function renderDiffSideBySide(aligned) {
    var html = '<div class="mdc-table mdc-table-split">';
    // 列头
    html += '<div class="mdc-head">' +
      '<div class="mdc-head-col mdc-head-left"><span class="mdc-head-tag mdc-tag-orig">原文 (消除前)</span></div>' +
      '<div class="mdc-head-col mdc-head-right"><span class="mdc-head-tag mdc-tag-rev">改写后 (消除后)</span></div>' +
      '</div>';

    html += '<div class="mdc-body">';
    for (var i = 0; i < aligned.length; i++) {
      var row = aligned[i];
      var rendered = renderLineDiff(row);
      var isPlaceholderLeft = row.lineA == null;
      var isPlaceholderRight = row.lineB == null;

      html += '<div class="mdc-row mdc-row-' + row.type + '">' +
        // 左列（原文）
        '<div class="mdc-cell mdc-cell-left' + (isPlaceholderLeft ? ' mdc-cell-empty' : '') + '">' +
        '<span class="mdc-num">' + (row.lineA != null ? row.lineA : '') + '</span>' +
        '<div class="mdc-code">' + (isPlaceholderLeft ? '<span class="mdc-gap-line"></span>' : (rendered.left || '&nbsp;')) + '</div>' +
        '</div>' +
        // 右列（改写后）
        '<div class="mdc-cell mdc-cell-right' + (isPlaceholderRight ? ' mdc-cell-empty' : '') + '">' +
        '<span class="mdc-num">' + (row.lineB != null ? row.lineB : '') + '</span>' +
        '<div class="mdc-code">' + (isPlaceholderRight ? '<span class="mdc-gap-line"></span>' : (rendered.right || '&nbsp;')) + '</div>' +
        '</div>' +
        '</div>';
    }
    html += '</div></div>';
    return html;
  }

  /**
   * 渲染单栏合并对照 (Unified View)
   */
  function renderDiffUnified(aligned) {
    var html = '<div class="mdc-table mdc-table-unified">';
    html += '<div class="mdc-head">' +
      '<div class="mdc-head-col"><span class="mdc-head-tag mdc-tag-uni">单栏综合版本对照 (红删绿增)</span></div>' +
      '</div>';

    html += '<div class="mdc-body">';
    for (var i = 0; i < aligned.length; i++) {
      var row = aligned[i];
      if (row.type === 'eq') {
        html += '<div class="mdc-uni-row mdc-uni-eq">' +
          '<span class="mdc-num mdc-num-a">' + row.lineA + '</span>' +
          '<span class="mdc-num mdc-num-b">' + row.lineB + '</span>' +
          '<span class="mdc-sign">&nbsp;</span>' +
          '<div class="mdc-code">' + (esc(row.a) || '&nbsp;') + '</div>' +
          '</div>';
      } else if (row.type === 'del') {
        html += '<div class="mdc-uni-row mdc-uni-del">' +
          '<span class="mdc-num mdc-num-a">' + row.lineA + '</span>' +
          '<span class="mdc-num mdc-num-b"></span>' +
          '<span class="mdc-sign">-</span>' +
          '<div class="mdc-code"><del class="mdc-del">' + esc(row.a) + '</del></div>' +
          '</div>';
      } else if (row.type === 'add') {
        html += '<div class="mdc-uni-row mdc-uni-add">' +
          '<span class="mdc-num mdc-num-a"></span>' +
          '<span class="mdc-num mdc-num-b">' + row.lineB + '</span>' +
          '<span class="mdc-sign">+</span>' +
          '<div class="mdc-code"><ins class="mdc-ins">' + esc(row.b) + '</ins></div>' +
          '</div>';
      } else if (row.type === 'mod') {
        var rendered = renderLineDiff(row);
        // 先出删除行
        html += '<div class="mdc-uni-row mdc-uni-del">' +
          '<span class="mdc-num mdc-num-a">' + row.lineA + '</span>' +
          '<span class="mdc-num mdc-num-b"></span>' +
          '<span class="mdc-sign">-</span>' +
          '<div class="mdc-code">' + (rendered.left || '&nbsp;') + '</div>' +
          '</div>';
        // 后出新增行
        html += '<div class="mdc-uni-row mdc-uni-add">' +
          '<span class="mdc-num mdc-num-a"></span>' +
          '<span class="mdc-num mdc-num-b">' + row.lineB + '</span>' +
          '<span class="mdc-sign">+</span>' +
          '<div class="mdc-code">' + (rendered.right || '&nbsp;') + '</div>' +
          '</div>';
      }
    }
    html += '</div></div>';
    return html;
  }

  /**
   * 确保样式表注入
   */
  function ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById('molan-diffchecker-style')) return;
    var style = document.createElement('style');
    style.id = 'molan-diffchecker-style';
    style.textContent = '' +
      '.mdc-overlay { position: fixed; inset: 0; background: rgba(15, 17, 23, 0.65); backdrop-filter: blur(4px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }\n' +
      '.mdc-modal { background: #ffffff; border-radius: 18px; width: 100%; max-width: 1240px; height: 90vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.35); border: 1px solid #e5e7eb; box-sizing: border-box; }\n' +
      '.mdc-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; background: #ffffff; border-bottom: 1px solid #e5e7eb; gap: 12px; flex-wrap: wrap; }\n' +
      '.mdc-header-left { display: flex; align-items: center; gap: 12px; }\n' +
      '.mdc-btn-back { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; background: #f3f4f6; color: #1f2937; border: 1px solid #e5e7eb; border-radius: 999px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all .15s; }\n' +
      '.mdc-btn-back:hover { background: #e5e7eb; color: #111827; }\n' +
      '.mdc-title-box { display: flex; flex-direction: column; }\n' +
      '.mdc-title { font-size: 16px; font-weight: 700; color: #111827; margin: 0; line-height: 1.3; }\n' +
      '.mdc-subtitle { font-size: 12px; color: #6b7280; margin: 0; line-height: 1.3; }\n' +
      '.mdc-header-mid { display: flex; align-items: center; gap: 8px; }\n' +
      '.mdc-segmented { display: inline-flex; background: #f3f4f6; padding: 3px; border-radius: 999px; border: 1px solid #e5e7eb; }\n' +
      '.mdc-seg-btn { border: none; background: transparent; padding: 5px 14px; font-size: 12px; font-weight: 500; color: #4b5563; border-radius: 999px; cursor: pointer; transition: all .15s; }\n' +
      '.mdc-seg-btn.active { background: #111827; color: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }\n' +
      '.mdc-header-right { display: flex; align-items: center; gap: 10px; margin-left: auto; }\n' +
      '.mdc-btn-copy-all { display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; background: #16a34a; color: #ffffff; border: none; border-radius: 999px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 8px rgba(22, 163, 74, 0.25); transition: all .15s; }\n' +
      '.mdc-btn-copy-all:hover { background: #15803d; box-shadow: 0 4px 12px rgba(22, 163, 74, 0.35); }\n' +
      '.mdc-btn-close { width: 32px; height: 32px; border-radius: 999px; border: 1px solid #e5e7eb; background: #ffffff; color: #6b7280; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .15s; }\n' +
      '.mdc-btn-close:hover { background: #f3f4f6; color: #111827; }\n' +
      '.mdc-stats-bar { display: flex; align-items: center; justify-content: space-between; padding: 8px 20px; background: #fafafa; border-bottom: 1px solid #f0f0f0; font-size: 12px; color: #4b5563; flex-wrap: wrap; gap: 8px; }\n' +
      '.mdc-stats-items { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }\n' +
      '.mdc-stat-pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; font-weight: 500; font-size: 11px; }\n' +
      '.mdc-stat-del { background: #fee2e2; color: #991b1b; }\n' +
      '.mdc-stat-add { background: #dcfce7; color: #166534; }\n' +
      '.mdc-stat-mod { background: #fef3c7; color: #92400e; }\n' +
      '.mdc-scroll-container { flex: 1; overflow-y: auto; background: #ffffff; -webkit-overflow-scrolling: touch; }\n' +
      '.mdc-table { width: 100%; border-collapse: collapse; font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace, "PingFang SC", sans-serif; font-size: 13px; line-height: 1.7; }\n' +
      '.mdc-head { display: flex; background: #f9fafb; border-bottom: 1px solid #e5e7eb; font-weight: 600; font-size: 12px; color: #374151; }\n' +
      '.mdc-head-col { flex: 1; padding: 8px 16px; box-sizing: border-box; display: flex; align-items: center; }\n' +
      '.mdc-head-left { border-right: 1px solid #e5e7eb; }\n' +
      '.mdc-head-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; }\n' +
      '.mdc-tag-orig { background: #fee2e2; color: #991b1b; }\n' +
      '.mdc-tag-rev { background: #dcfce7; color: #166534; }\n' +
      '.mdc-tag-uni { background: #f3f4f6; color: #374151; }\n' +
      '.mdc-row { display: flex; align-items: stretch; border-bottom: 1px solid #f3f4f6; min-height: 26px; }\n' +
      '.mdc-cell { flex: 1; display: flex; align-items: flex-start; box-sizing: border-box; }\n' +
      '.mdc-cell-left { border-right: 1px solid #e5e7eb; }\n' +
      '.mdc-cell-empty { background: repeating-linear-gradient(45deg, #fafafa, #fafafa 10px, #f3f4f6 10px, #f3f4f6 20px); }\n' +
      '.mdc-gap-line { display: block; width: 100%; height: 100%; min-height: 22px; }\n' +
      '.mdc-num { display: inline-block; width: 44px; min-width: 44px; padding: 3px 8px; text-align: right; color: #9ca3af; background: #fafafa; border-right: 1px solid #f0f0f0; font-size: 11px; user-select: none; box-sizing: border-box; }\n' +
      '.mdc-code { flex: 1; padding: 3px 12px; white-space: pre-wrap; word-break: break-word; color: #1f2937; box-sizing: border-box; min-height: 22px; }\n' +
      '.mdc-row-del .mdc-cell-left { background: #fff5f5; }\n' +
      '.mdc-row-add .mdc-cell-right { background: #f6fef9; }\n' +
      '.mdc-row-mod .mdc-cell-left { background: #fffafa; }\n' +
      '.mdc-row-mod .mdc-cell-right { background: #f8fdf9; }\n' +
      '.mdc-del { background-color: #fecaca; color: #991b1b; text-decoration: line-through; border-radius: 2px; padding: 1px 3px; font-weight: 500; }\n' +
      '.mdc-ins { background-color: #bbf7d0; color: #166534; text-decoration: none; border-radius: 2px; padding: 1px 3px; font-weight: 600; }\n' +
      '.mdc-uni-row { display: flex; align-items: flex-start; border-bottom: 1px solid #f3f4f6; min-height: 26px; }\n' +
      '.mdc-num-a, .mdc-num-b { display: inline-block; width: 42px; min-width: 42px; padding: 3px 6px; text-align: right; color: #9ca3af; background: #fafafa; border-right: 1px solid #f0f0f0; font-size: 11px; user-select: none; box-sizing: border-box; }\n' +
      '.mdc-sign { display: inline-block; width: 22px; min-width: 22px; text-align: center; font-weight: 700; padding: 3px 0; user-select: none; }\n' +
      '.mdc-uni-del { background: #fff5f5; color: #991b1b; }\n' +
      '.mdc-uni-del .mdc-sign { color: #dc2626; }\n' +
      '.mdc-uni-add { background: #f6fef9; color: #166534; }\n' +
      '.mdc-uni-add .mdc-sign { color: #16a34a; }\n' +
      '.mdc-toast { position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%); background: #111827; color: #ffffff; padding: 10px 22px; border-radius: 999px; font-size: 13px; font-weight: 500; z-index: 100000; box-shadow: 0 10px 25px rgba(0,0,0,0.25); pointer-events: none; animation: mdcFade 0.2s ease-out; }\n' +
      '@keyframes mdcFade { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }\n' +
      '@media (max-width: 768px) {\n' +
      '  .mdc-modal { height: 96vh; border-radius: 12px; }\n' +
      '  .mdc-header { padding: 10px 12px; }\n' +
      '  .mdc-header-right { width: 100%; justify-content: flex-end; margin-top: 4px; }\n' +
      '  .mdc-stats-bar { padding: 6px 12px; }\n' +
      '  .mdc-table-split .mdc-row { flex-direction: column; }\n' +
      '  .mdc-cell-left { border-right: none; border-bottom: 1px dashed #e5e7eb; }\n' +
      '}\n';
    document.head.appendChild(style);
  }

  function showToast(msg) {
    if (typeof document === 'undefined') return;
    var old = document.querySelector('.mdc-toast');
    if (old) old.remove();
    var toast = document.createElement('div');
    toast.className = 'mdc-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 2200);
  }

  /**
   * 打开墨阑 Diffchecker 对比弹窗
   * @param {Object} options
   * @param {string} options.original 原文内容
   * @param {string} options.revised 改写后内容
   * @param {string} [options.title] 标题
   * @param {Function} [options.onBack] 返回工作台回调
   * @param {Function} [options.onClose] 关闭回调
   */
  function openDiffcheckerModal(options) {
    options = options || {};
    var original = String(options.original || '');
    var revised = String(options.revised || '');
    var title = options.title || '去 AI 味对比工具';
    var onBack = options.onBack;
    var onClose = options.onClose;

    ensureStyles();

    // 预计算对齐与统计
    var linesA = original.split(/\r?\n/);
    var linesB = revised.split(/\r?\n/);
    var aligned = alignLines(linesA, linesB);
    var stats = computeStats(aligned, original, revised);

    var currentMode = 'split'; // 'split' | 'unified'

    // 创建 DOM
    var overlay = document.createElement('div');
    overlay.className = 'mdc-overlay';

    var modal = document.createElement('div');
    modal.className = 'mdc-modal';

    // 顶部工具栏
    var header = document.createElement('div');
    header.className = 'mdc-header';
    header.innerHTML = '' +
      '<div class="mdc-header-left">' +
      '<button class="mdc-btn-back" id="mdcBackBtn" title="返回工作台">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>' +
      '返回工作台</button>' +
      '<div class="mdc-title-box">' +
      '<h2 class="mdc-title">' + esc(title) + '</h2>' +
      '<p class="mdc-subtitle">基于 Stop AI Slop 准则精细对比</p>' +
      '</div>' +
      '</div>' +
      '<div class="mdc-header-mid">' +
      '<div class="mdc-segmented">' +
      '<button class="mdc-seg-btn active" id="mdcBtnSplit">并排对比 (Split)</button>' +
      '<button class="mdc-seg-btn" id="mdcBtnUnified">单栏合并 (Unified)</button>' +
      '</div>' +
      '</div>' +
      '<div class="mdc-header-right">' +
      '<button class="mdc-btn-copy-all" id="mdcCopyRevisedBtn" title="直接复制改写后全文">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>' +
      '复制改写后全文</button>' +
      '<button class="mdc-btn-close" id="mdcCloseBtn" aria-label="关闭">✕</button>' +
      '</div>';

    // 统计条
    var statsBar = document.createElement('div');
    statsBar.className = 'mdc-stats-bar';
    var diffSign = stats.charDiff > 0 ? ('+' + stats.charDiff) : String(stats.charDiff);
    statsBar.innerHTML = '' +
      '<div class="mdc-stats-items">' +
      '<span>原文 <strong>' + stats.origChars + '</strong> 字</span>' +
      '<span>→</span>' +
      '<span>改写后 <strong>' + stats.revChars + '</strong> 字</span>' +
      '<span>(' + diffSign + ' 字)</span>' +
      '</div>' +
      '<div class="mdc-stats-items">' +
      '<span class="mdc-stat-pill mdc-stat-del">-' + stats.delCount + ' 处删除</span>' +
      '<span class="mdc-stat-pill mdc-stat-add">+' + stats.addCount + ' 处新增</span>' +
      '<span class="mdc-stat-pill mdc-stat-mod">' + stats.modLines + ' 行修改</span>' +
      '</div>';

    // 内容滚动区
    var scrollContainer = document.createElement('div');
    scrollContainer.className = 'mdc-scroll-container';

    function renderContent() {
      if (currentMode === 'split') {
        scrollContainer.innerHTML = renderDiffSideBySide(aligned);
      } else {
        scrollContainer.innerHTML = renderDiffUnified(aligned);
      }
    }

    renderContent();

    modal.appendChild(header);
    modal.appendChild(statsBar);
    modal.appendChild(scrollContainer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function closeModal() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.body.style.overflow = prevOverflow;
      if (typeof onClose === 'function') onClose();
    }

    function backToWorkbench() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.body.style.overflow = prevOverflow;
      if (typeof onBack === 'function') onBack();
    }

    // 事件绑定
    var btnSplit = modal.querySelector('#mdcBtnSplit');
    var btnUnified = modal.querySelector('#mdcBtnUnified');
    var btnBack = modal.querySelector('#mdcBackBtn');
    var btnClose = modal.querySelector('#mdcCloseBtn');
    var btnCopy = modal.querySelector('#mdcCopyRevisedBtn');

    btnSplit.addEventListener('click', function () {
      if (currentMode === 'split') return;
      currentMode = 'split';
      btnSplit.classList.add('active');
      btnUnified.classList.remove('active');
      renderContent();
    });

    btnUnified.addEventListener('click', function () {
      if (currentMode === 'unified') return;
      currentMode = 'unified';
      btnUnified.classList.add('active');
      btnSplit.classList.remove('active');
      renderContent();
    });

    btnBack.addEventListener('click', backToWorkbench);
    btnClose.addEventListener('click', closeModal);

    btnCopy.addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(revised).then(function () {
          showToast('已复制改写后全文');
        }).catch(function () {
          fallbackCopy(revised);
        });
      } else {
        fallbackCopy(revised);
      }
    });

    function fallbackCopy(text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
        showToast('已复制改写后全文');
      } catch (e) {
        showToast('复制失败，请手动选择复制');
      }
      document.body.removeChild(ta);
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    function handleKeydown(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', handleKeydown);
        closeModal();
      }
    }
    document.addEventListener('keydown', handleKeydown);

    return {
      close: closeModal,
      back: backToWorkbench
    };
  }

  var MolanDiffChecker = {
    tokenize: tokenize,
    charSimilarity: charSimilarity,
    lcsTokenDiff: lcsTokenDiff,
    alignLines: alignLines,
    computeStats: computeStats,
    renderDiffSideBySide: renderDiffSideBySide,
    renderDiffUnified: renderDiffUnified,
    openDiffcheckerModal: openDiffcheckerModal
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MolanDiffChecker;
  }
  if (typeof window !== 'undefined') {
    window.MolanDiffChecker = MolanDiffChecker;
    window.openDiffcheckerModal = openDiffcheckerModal;
  }

})(typeof window !== 'undefined' ? window : global);
