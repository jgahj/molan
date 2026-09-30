import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_PATH = path.join(ROOT, 'data', 'feature-contracts.json');
const NON_WORKFLOW_PAGES = new Set([
  'pages/about.html', 'pages/blog.html', 'pages/contact.html',
  'pages/docs.html', 'pages/features.html', 'pages/pricing.html',
  'pages/editor.html', 'pages/editor.js'
]);

/** 在限定的产品代码和测试目录中读取可审计源码。 */
export async function loadAuditSources(root = ROOT) {
  const files = new Set(['server.js', 'index.html', 'completion-editor.js', 'completion-import.js', 'completion-library.js']);
  const directories = ['pages', 'lib/client', 'lib/generation', 'lib/quality', 'lib/evolution', 'lib/repositories', 'routes', 'services', 'test'];
  for (const directory of directories) {
    const absolute = path.join(root, directory);
    let entries;
    try { entries = await readdir(absolute, { withFileTypes: true }); } catch (_) { continue; }
    const pending = entries.map(entry => ({ entry, relative: path.join(directory, entry.name) }));
    while (pending.length) {
      const { entry, relative } = pending.pop();
      if (entry.isDirectory()) {
        if (['node_modules', 'books', 'raws', 'generated', 'deploy_tmp', 'tmp-booktest'].includes(entry.name)) continue;
        const children = await readdir(path.join(root, relative), { withFileTypes: true });
        children.forEach(child => pending.push({ entry: child, relative: path.join(relative, child.name) }));
      } else if (/\.(?:js|mjs|cjs|html)$/.test(entry.name)) files.add(relative);
    }
  }
  const sources = new Map();
  for (const relative of files) {
    try { sources.set(relative.replace(/\\/g, '/'), await readFile(path.join(root, relative), 'utf8')); } catch (_) {}
  }
  return sources;
}

/** 将注册表要求的能力和代码证据映射为 PASS、PARTIAL 或 FAIL。 */
export function auditContracts(contracts, sources) {
  const results = [];
  for (const [featureId, contract] of Object.entries(contracts || {})) {
    const missing = [];
    const required = Array.isArray(contract.required) ? contract.required : [];
    if (!required.length) missing.push('contract:required');
    if (new Set(required).size !== required.length) missing.push('contract:duplicate-required');
    for (const [capability, value] of Object.entries(contract)) {
      if (value === true && !required.includes(capability)) missing.push(`contract:untracked-capability:${capability}`);
    }
    for (const capability of required) {
      if (typeof contract[capability] !== 'boolean' || contract[capability] !== true) {
        missing.push(`capability:${capability}`);
      }
    }
    const evidence = contract.evidence && typeof contract.evidence === 'object' ? contract.evidence : {};
    for (const capability of required) {
      if (!Object.hasOwn(evidence, capability)) missing.push(`evidence:${capability}`);
    }
    for (const label of Object.keys(evidence)) {
      if (!required.includes(label)) missing.push(`evidence:not-required:${label}`);
    }
    for (const [label, entry] of Object.entries(evidence)) {
      const file = String(entry && entry.file || '').replace(/\\/g, '/');
      const expected = String(entry && entry.includes || '');
      if (!file || !expected || !sources.has(file) || !sources.get(file).includes(expected)) {
        missing.push(`evidence:${label}`);
      }
    }
    const capabilityFailed = missing.some(item => item.startsWith('capability:'));
    const status = capabilityFailed ? 'FAIL' : missing.length ? 'PARTIAL' : 'PASS';
    results.push({ featureId, displayName: String(contract.displayName || featureId), status, missing });
  }
  return results;
}

/** 检查源码中显式声明的功能标记是否均能在注册表中找到。 */
export function findUnknownFeatureMarkers(sources, contracts) {
  const known = new Set(Object.keys(contracts || {}));
  const unknown = new Set();
  for (const [file, source] of sources.entries()) {
    if (file.startsWith('test/')) continue;
    for (const match of source.matchAll(/data-feature\s*=\s*["']([^"']+)["']/g)) {
      if (!known.has(match[1])) unknown.add(match[1]);
    }
  }
  return Array.from(unknown).sort();
}

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

function quotedValue(value) {
  const escaped = escapeRegExp(value);
  return `(?:"${escaped}"|'${escaped}')`;
}

function scriptBundle(file, source, sources) {
  const chunks = [source];
  for (const match of source.matchAll(/<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
    const raw = String(match[1] || match[2] || match[3] || '').split(/[?#]/, 1)[0];
    if (!raw || /^(?:[a-z]+:)?\/\//i.test(raw)) continue;
    const candidates = raw.startsWith('/')
      ? [raw.slice(1)]
      : [path.posix.normalize(path.posix.join(path.posix.dirname(file), raw)), raw.replace(/^\.\//, '')];
    const candidate = candidates.map(item => item.replace(/\\/g, '/')).find(item => sources.has(item));
    if (candidate && !chunks.includes(sources.get(candidate))) chunks.push(sources.get(candidate));
  }
  if (/^completion-(?:editor|import|library)\.js$/.test(file)) {
    for (const [candidate, content] of sources) {
      if (/^completion-(?:editor|import|library)\.js$/.test(candidate) && !chunks.includes(content)) chunks.push(content);
    }
    const applicationShell = sources.get('index.html');
    if (applicationShell && !chunks.includes(applicationShell)) chunks.push(applicationShell);
  }
  return chunks.join('\n');
}

function hasDirectEventBinding(value, bundle, events) {
  if (!value || value.includes('${')) return false;
  if (hasArrayLoopBinding(value, bundle, events)) return true;
  const quoted = quotedValue(value);
  const escaped = escapeRegExp(value);
  const accessor = `(?:(?:[A-Za-z_$][\\w$]*\\s*\\.\\s*)?(?:getElementById|querySelector(?:All)?)\\s*\\(\\s*(?:${quoted}|['"]#${escaped}['"])\\s*\\)|[A-Za-z_$][\\w$]*\\s*\\(\\s*(?:${quoted}|['"]#${escaped}['"])\\s*\\))`;
  const bound = new RegExp(`${accessor}\\s*(?:\\?\\.|\\.)\\s*(?:addEventListener\\s*\\(\\s*['"](?:${events.join('|')})['"]|on(?:${events.join('|')})\\s*=)`, 'i');
  if (bound.test(bundle)) return true;
  const assignment = new RegExp(`(?:\\b(?:const|let|var)\\s+|[,;]\\s*)([A-Za-z_$][\\w$]*)\\s*=\\s*${accessor}`, 'g');
  for (const found of bundle.matchAll(assignment)) {
    const tail = bundle.slice(found.index, found.index + 900);
    const handler = new RegExp(`\\b${escapeRegExp(found[1])}\\s*(?:\\?\\.|\\.)\\s*(?:addEventListener\\s*\\(\\s*['"](?:${events.join('|')})['"]|on(?:${events.join('|')})\\s*=)`, 'i');
    if (handler.test(tail)) return true;
    if (!/^(?:btn|button|input|select|el|element|node|item|target|action|control|field)$/i.test(found[1]) && handler.test(bundle)) return true;
  }
  return false;
}

function hasArrayLoopBinding(value, bundle, events) {
  const targetValue = new RegExp(quotedValue(value), 'i');
  const loops = /for\s*\(\s*(?:const|let|var)\s+(\[[^\]]+\]|[A-Za-z_$][\w$]*)\s+of\s+([^\n]+?)\)\s*([^\n]*)/g;
  for (const match of bundle.matchAll(loops)) {
    if (!targetValue.test(match[2])) continue;
    const target = match[1].startsWith('[') ? match[1].match(/^\[\s*([A-Za-z_$][\w$]*)/)?.[1] : match[1];
    if (!target) continue;
    const body = match[3];
    const accessor = new RegExp(`(?:[A-Za-z_$][\\w$]*\\s*\\(\\s*${escapeRegExp(target)}\\s*\\)|[A-Za-z_$][\\w$]*\\s*\\[\\s*${escapeRegExp(target)}\\s*\\])\\s*\\.\\s*(?:addEventListener\\s*\\(\\s*['"](?:${events.join('|')})['"]|on(?:${events.join('|')})\\s*=)`, 'i');
    if (accessor.test(body)) return true;
  }
  return false;
}

function hasRuntimeDisabledState(value, bundle) {
  if (!value || value.includes('${')) return false;
  const quoted = quotedValue(value);
  const escaped = escapeRegExp(value);
  const accessor = `(?:(?:[A-Za-z_$][\\w$]*\\s*\\.\\s*)?(?:getElementById|querySelector(?:All)?)\\s*\\(\\s*(?:${quoted}|['"]#${escaped}['"])\\s*\\)|[A-Za-z_$][\\w$]*\\s*\\(\\s*(?:${quoted}|['"]#${escaped}['"])\\s*\\))`;
  if (new RegExp(`${accessor}\\s*\\.\\s*disabled\\s*=\\s*true`, 'i').test(bundle)) return true;
  const assignment = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${accessor}`, 'g');
  for (const match of bundle.matchAll(assignment)) {
    if (new RegExp(`\\b${escapeRegExp(match[1])}\\s*\\.\\s*disabled\\s*=\\s*true`, 'i').test(bundle)) return true;
  }
  return false;
}

function hasClassEventBinding(classValue, bundle, events) {
  const classes = String(classValue || '').split(/\s+/).filter(Boolean);
  return classes.some(className => {
    const selector = new RegExp(`(?:closest|matches|querySelector(?:All)?)\\s*\\(\\s*['"][^'"]*\\.${escapeRegExp(className)}(?:[^a-zA-Z0-9_-]|$)`, 'i');
    const listener = new RegExp(`addEventListener\\s*\\(\\s*['"](?:${events.join('|')})['"]`, 'i');
    return selector.test(bundle) && listener.test(bundle);
  });
}

function hasCollectionCallbackBinding(bundle, match, events) {
  const callbackStart = match.index + match[0].length;
  const loop = bundle.slice(callbackStart).match(/^\s*\.forEach\s*\(/);
  if (!loop) return false;
  const openIndex = callbackStart + loop.index + loop[0].lastIndexOf('(');
  const closeIndex = matchingParenEnd(bundle, openIndex);
  if (closeIndex < 0) return false;
  const callback = bundle.slice(openIndex + 1, closeIndex).trim();
  const inlineHandler = /^(?:(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)|(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/.test(callback);
  const namedHandler = /^[A-Za-z_$][\w$]*$/.test(callback) ? namedHandlerBody(callback, bundle) : '';
  const body = inlineHandler ? callback : namedHandler;
  return new RegExp(`addEventListener\\s*\\(\\s*['"](?:${events.join('|')})['"]`, 'i').test(body);
}

function hasClassTargetEventBinding(classValue, bundle, events) {
  const classes = String(classValue || '').split(/\s+/).filter(Boolean);
  return classes.some(className => {
    const selector = `(?:[A-Za-z_$][\\w$]*\\s*\\.\\s*)?querySelector\\s*\\(\\s*['"][^'"]*\\.${escapeRegExp(className)}(?:[^a-zA-Z0-9_-]|$)[^'"]*['"]\\s*\\)|[A-Za-z_$][\\w$]*\\s*\\(\\s*['"][^'"]*\\.${escapeRegExp(className)}(?:[^a-zA-Z0-9_-]|$)[^'"]*['"]\\s*\\)`;
    const listener = `(?:addEventListener\\s*\\(\\s*['"](?:${events.join('|')})['"]|on(?:${events.join('|')})\\s*=)`;
    if (new RegExp(`${selector}\\s*(?:\\?\\.|\\.)\\s*${listener}`, 'i').test(bundle)) return true;
    const assignment = new RegExp(`(?:\\b(?:const|let|var)\\s+|[,;]\\s*)([A-Za-z_$][\\w$]*)\\s*=\\s*${selector}`, 'g');
    for (const match of bundle.matchAll(assignment)) {
      const handler = new RegExp(`\\b${escapeRegExp(match[1])}\\s*(?:\\?\\.|\\.)\\s*${listener}`, 'i');
      if (handler.test(bundle)) return true;
    }
    const helperSelection = new RegExp(`[A-Za-z_$][\\w$]*\\s*\\(\\s*['"][^'"]*\\.${escapeRegExp(className)}(?=[^a-zA-Z0-9_-]|$)[^'"]*['"]\\s*\\)`, 'gi');
    for (const match of bundle.matchAll(helperSelection)) {
      if (hasCollectionCallbackBinding(bundle, match, events)) return true;
    }
    const collection = new RegExp(`querySelectorAll\\s*\\(\\s*['"][^'"]*\\.${escapeRegExp(className)}(?=[^a-zA-Z0-9_-]|$)[^'"]*['"]\\s*\\)`, 'gi');
    for (const match of bundle.matchAll(collection)) {
      if (hasCollectionCallbackBinding(bundle, match, events)) return true;
    }
    return false;
  });
}

function hasBoundSelector(attribute, bundle, events) {
  const name = escapeRegExp(attribute);
  const selector = new RegExp(`(?:closest|matches|querySelector(?:All)?)\\s*\\(\\s*['"][^'"]*\\[\\s*${name}(?:\\s*=|\\s*\\])`, 'i');
  const listener = new RegExp(`addEventListener\\s*\\(\\s*['"](?:${events.join('|')})['"]`, 'i');
  const camel = attribute.replace(/^data-/, '').replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
  const readsAttribute = bundle.includes(`.dataset.${camel}`) || bundle.includes(`getAttribute('${attribute}')`) ||
    bundle.includes(`getAttribute("${attribute}")`);
  return (selector.test(bundle) || readsAttribute) && listener.test(bundle);
}

function hasExactAttributeBinding(attribute, value, bundle, events) {
  if (!value || value.includes('${')) return false;
  const selector = new RegExp(`\\[\\s*${escapeRegExp(attribute)}\\s*=\\s*${quotedValue(value)}\\s*\\]`, 'g');
  const listener = new RegExp(`addEventListener\\s*\\(\\s*['"](?:${events.join('|')})['"]`, 'i');
  for (const found of bundle.matchAll(selector)) {
    if (listener.test(bundle.slice(found.index, found.index + 700))) return true;
  }
  return false;
}

function hasDynamicAttributeReadback(attribute, bundle) {
  const selector = new RegExp(`\\[\\s*${escapeRegExp(attribute)}\\s*=`, 'i');
  return selector.test(bundle) && /\.value\b/.test(bundle) && /addEventListener\s*\(\s*['"](?:click|submit)['"]/.test(bundle);
}

function hasDynamicTemplateControlBinding(attributes, kind, bundle) {
  const dynamicAttributes = Array.from(attributes.entries()).filter(([, value]) => String(value).includes('${'));
  if (!dynamicAttributes.length) return false;
  const eventNames = ['input', 'select'].includes(kind) ? ['input', 'change'] : ['click'];
  const tagName = kind === 'a' ? 'a' : kind;
  const query = new RegExp(`querySelectorAll\\s*\\(\\s*['"][^'"]*\\b${tagName}\\b[^'"]*['"]\\s*\\)`, 'gi');
  for (const match of bundle.matchAll(query)) {
    const tail = bundle.slice(match.index, match.index + 1200);
    const bindsEvent = new RegExp(`addEventListener\\s*\\(\\s*['"](?:${eventNames.join('|')})['"]`, 'i').test(tail);
    const readsDynamicAttributes = dynamicAttributes.every(([name]) => {
      const camel = name.replace(/^data-/, '').replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
      return tail.includes(`.dataset.${camel}`) || tail.includes(`getAttribute('${name}')`) || tail.includes(`getAttribute("${name}")`);
    });
    if (bindsEvent && readsDynamicAttributes) return true;
  }
  return false;
}

function actionValueHandled(attribute, value, bundle) {
  const camel = attribute.replace(/^data-/, '').replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
  const read = bundle.includes(`.dataset.${camel}`) || bundle.includes(`getAttribute('${attribute}')`) ||
    bundle.includes(`getAttribute("${attribute}")`);
  if (!value) return true;
  if (value.includes('${')) return !['data-action', 'data-completion-action'].includes(attribute) && read;
  if (!read) return false;
  if (!['data-action', 'data-completion-action'].includes(attribute)) return true;
  const dispatch = new RegExp(`(?:===|!==|case\\s+)\\s*${quotedValue(value)}`, 'i');
  if (dispatch.test(bundle)) return true;
  const candidates = Array.from(value.matchAll(/['"]([a-z][a-z0-9_-]*)['"]/gi), match => match[1]);
  return candidates.length > 1 && candidates.every(candidate =>
    new RegExp(`(?:===|!==|case\\s+)\\s*${quotedValue(candidate)}`, 'i').test(bundle));
}

function hasControlReadback(value, bundle) {
  if (!value) return false;
  const prefix = String(value).split('${', 1)[0];
  if (!prefix) return false;
  const escaped = escapeRegExp(prefix);
  const idAccess = `(?:(?:[A-Za-z_$][\\w$]*\\s*\\.\\s*)?(?:getElementById|querySelector))\\s*\\(\\s*(?:['"]#?${escaped}[^'"]*['"]|\\x60${escaped}|['"][^'"]*\\[name=['"]${escaped}['"])`;
  const helperAccess = `[A-Za-z_$][\\w$]*\\s*\\(\\s*(?:${quotedValue(prefix)}|['"]#${escaped}['"])\\s*\\)`;
  const readback = new RegExp(`(?:${idAccess}|${helperAccess})[\\s\\S]{0,120}?(?:\\.value|\\.checked)`, 'i').test(bundle);
  return readback && /addEventListener\s*\(\s*['"](?:click|submit)['"]/.test(bundle);
}

function hasModalConfirmReadback(value, bundle) {
  if (!value || value.includes('${')) return false;
  const access = new RegExp(`(?:getElementById|querySelector)\\s*\\(\\s*(?:${quotedValue(value)}|['"]#${escapeRegExp(value)}['"])\\s*\\)`, 'i');
  for (const match of bundle.matchAll(/onConfirm\s*:/g)) {
    const openIndex = bundle.indexOf('{', match.index + match[0].length);
    const closeIndex = matchingBraceEnd(bundle, openIndex);
    if (openIndex < 0 || closeIndex < 0) continue;
    const handler = bundle.slice(openIndex + 1, closeIndex);
    if (access.test(handler) && /\.(?:value|files|checked)\b/.test(handler)) return true;
  }
  return false;
}

function matchingBraceEnd(source, openIndex) {
  let depth = 0;
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (char === '\\') { index += 1; continue; }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === '\'' || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return index;
  }
  return -1;
}

function namedHandlerBody(name, bundle) {
  const escaped = escapeRegExp(name);
  const declaration = new RegExp(`(?:\\b(?:async\\s+)?function\\s+${escaped}\\s*\\([^)]*\\)\\s*|\\b(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*)\\{`, 'g');
  const match = declaration.exec(bundle);
  if (!match) return '';
  const openIndex = declaration.lastIndex - 1;
  const closeIndex = matchingBraceEnd(bundle, openIndex);
  return closeIndex < 0 ? '' : bundle.slice(openIndex + 1, closeIndex);
}

function matchingParenEnd(source, openIndex) {
  let depth = 0;
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (char === '\\') { index += 1; continue; }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === '\'' || char === '"' || char === '`') { quote = char; continue; }
    if (char === '(') depth += 1;
    else if (char === ')' && --depth === 0) return index;
  }
  return -1;
}

function hasDelegatedIdBinding(id, bundle, events) {
  if (!id || id.includes('${')) return false;
  const quoted = quotedValue(id);
  for (const eventName of events) {
    const registration = new RegExp(`document\\.addEventListener\\s*\\(\\s*['"]${eventName}['"]\\s*,\\s*([A-Za-z_$][\\w$]*)`, 'gi');
    for (const match of bundle.matchAll(registration)) {
      const handler = namedHandlerBody(match[1], bundle);
      if (!handler) continue;
      const readsControl = new RegExp(`\\b[A-Za-z_$][\\w$]*\\s*\\.\\s*id\\s*={2,3}\\s*${quoted}`, 'i').test(handler);
      const consumesValue = /\.(?:value|checked|files|selectedIndex)\b/.test(handler) ||
        /\b(?:update|render|save|apply|handle|estimate|select|set)[A-Za-z_$\w]*\s*\(/i.test(handler);
      if (readsControl && consumesValue) return true;
    }
  }
  return false;
}

function hasScopedFormControlBinding(formId, kind, bundle) {
  if (!formId || !['input', 'select', 'textarea'].includes(kind)) return false;
  const selector = new RegExp(`querySelectorAll\\s*\\(\\s*(['"][^'"]*#${escapeRegExp(formId)}\\s+${kind}[^'"]*['"])\\s*\\)`, 'gi');
  for (const match of bundle.matchAll(selector)) {
    const tail = bundle.slice(match.index, match.index + 1000);
    if (/\.forEach\s*\(/.test(tail) && /\.addEventListener\s*\(\s*['"](?:input|change)['"]/.test(tail)) return true;
  }
  return false;
}

function enclosingFormId(source, index, attributes) {
  if (attributes.has('form')) return attributes.get('form');
  let cur = index;
  let depth = 0;
  while (cur > 0) {
    const nextOpen = source.lastIndexOf('<form', cur);
    const nextClose = source.lastIndexOf('</form', cur);
    if (nextOpen < 0 && nextClose < 0) return '';
    if (nextClose > nextOpen) {
      depth++;
      cur = nextClose - 1;
    } else {
      if (depth === 0) {
        const close = source.indexOf('>', nextOpen);
        const id = source.slice(nextOpen, close + 1).match(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        return id ? id[1] || id[2] || '' : '';
      }
      depth--;
      cur = nextOpen - 1;
    }
  }
  return '';
}

function enclosingFormClasses(source, index, attributes) {
  if (attributes.has('form')) return '';
  let cur = index;
  let depth = 0;
  while (cur > 0) {
    const nextOpen = source.lastIndexOf('<form', cur);
    const nextClose = source.lastIndexOf('</form', cur);
    if (nextOpen < 0 && nextClose < 0) return '';
    if (nextClose > nextOpen) {
      depth++;
      cur = nextClose - 1;
    } else {
      if (depth === 0) {
        const close = source.indexOf('>', nextOpen);
        const classes = source.slice(nextOpen, close + 1).match(/\bclass\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        return classes ? classes[1] || classes[2] || '' : '';
      }
      depth--;
      cur = nextOpen - 1;
    }
  }
  return '';
}

function enclosingParentClasses(source, index) {
  let cur = index;
  let depth = 0;
  while (cur > 0) {
    const nextOpen = source.lastIndexOf('<div', cur);
    const nextClose = source.lastIndexOf('</div>', cur);
    if (nextOpen < 0 && nextClose < 0) return [];
    if (nextClose > nextOpen) {
      depth++;
      cur = nextClose - 1;
    } else {
      if (depth === 0) {
        const close = source.indexOf('>', nextOpen);
        const match = source.slice(nextOpen, close + 1).match(/\bclass\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        return String(match && (match[1] || match[2]) || '').split(/\s+/).filter(Boolean);
      }
      depth--;
      cur = nextOpen - 1;
    }
  }
  return [];
}

function hasExactSelectorBinding(attributes, bundle, events) {
  const listener = new RegExp(`addEventListener\\s*\\(\\s*['"](?:${events.join('|')})['"]`, 'i');
  for (const [name, value] of attributes) {
    if (!value || value.includes('${')) continue;
    const selector = new RegExp(`\\[\\s*${escapeRegExp(name)}\\s*=\\s*${quotedValue(value)}\\s*\\]`, 'g');
    for (const match of bundle.matchAll(selector)) {
      const tail = bundle.slice(match.index, match.index + 700);
      if (listener.test(tail)) return true;
      const delegated = tail.match(/\.forEach\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/);
      if (delegated && listener.test(namedHandlerBody(delegated[1], bundle))) return true;
      if (/\.forEach\s*\(\s*(?:async\s*)?function\s*\(/.test(tail) && listener.test(tail)) return true;
    }
  }
  return false;
}

/** 盘点交互控件。单独的 id 或 data-feature 标签不作为处理器证据。 */
export function scanInteractiveControls(sources) {
  const controls = [];
  for (const [file, source] of sources.entries()) {
    if (file.startsWith('test/')) continue;
    const bundle = scriptBundle(file, source, sources);
    for (const match of source.matchAll(/<(button|a|input|select)\b[^>]*>/gi)) {
      const tag = match[0];
      const kind = match[1].toLowerCase();
      const attributes = new Map();
      for (const attr of tag.matchAll(/\b([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        if (attr[1].toLowerCase() !== kind) attributes.set(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? '');
      }
      const featureMarker = attributes.get('data-feature') || '';
      const events = ['input', 'select'].includes(kind) ? ['input', 'change', 'submit'] : ['click', 'submit', 'change'];
      const inlineBinding = [...attributes.keys()].some(name => new RegExp(`^on(?:${events.join('|')})$`, 'i').test(name));
      const primaryAction = ['data-action', 'data-completion-action', 'data-completion-ai-apply', 'data-completion-ai-revise', 'data-completion-ai-retry']
        .find(name => attributes.has(name));
      const actionMapped = primaryAction && hasBoundSelector(primaryAction, bundle, events) &&
        (actionValueHandled(primaryAction, attributes.get(primaryAction), bundle) ||
          hasExactAttributeBinding(primaryAction, attributes.get(primaryAction), bundle, events) || hasDynamicAttributeReadback(primaryAction, bundle));
      const dataMapped = [...attributes.keys()].some(name => name.startsWith('data-') && name !== 'data-feature' && name !== primaryAction &&
        (hasBoundSelector(name, bundle, events) && actionValueHandled(name, attributes.get(name), bundle) ||
          hasExactAttributeBinding(name, attributes.get(name), bundle, events) || hasDynamicAttributeReadback(name, bundle)));
      const formId = enclosingFormId(source, match.index, attributes);
      const formMapped = Boolean(formId && hasDirectEventBinding(formId, bundle, ['submit']));
      const formClasses = enclosingFormClasses(source, match.index, attributes).split(/\s+/).filter(Boolean);
      const formClassMapped = hasClassTargetEventBinding(formClasses.join(' '), bundle, ['submit']);
      const href = attributes.get('href') || '';
      const fragmentNavigation = kind === 'a' && /^#[^#\s]+$/.test(href) &&
        new RegExp(`\\bid\\s*=\\s*['"]${escapeRegExp(href.slice(1))}['"]`, 'i').test(source);
      const navigation = kind === 'a' && Boolean(href.trim()) && href !== '#' && !/^javascript:/i.test(href) || fragmentNavigation;
      const passive = attributes.has('disabled') || attributes.has('readonly') || attributes.get('type') === 'hidden' ||
        kind === 'input' && attributes.has('hidden') && attributes.get('type') === 'file';
      const direct = hasDirectEventBinding(attributes.get('id'), bundle, events) ||
        hasDirectEventBinding(attributes.get('name'), bundle, events);
      const parentClasses = enclosingParentClasses(source, match.index);
      const classBinding = hasClassEventBinding(attributes.get('class'), bundle, events) ||
        hasClassTargetEventBinding(attributes.get('class'), bundle, events) ||
        hasClassTargetEventBinding(parentClasses.join(' '), bundle, events);
      const delegatedBinding = ['input', 'select'].includes(kind) && hasDelegatedIdBinding(attributes.get('id'), bundle, events);
      const formReadback = ['input', 'select'].includes(kind) && (
        hasControlReadback(attributes.get('id') || attributes.get('name'), bundle) ||
        hasModalConfirmReadback(attributes.get('id') || attributes.get('name'), bundle)
      );
      const scopedFormBinding = Boolean(formId && hasScopedFormControlBinding(formId, kind, bundle));
      const runtimeDisabled = kind === 'button' && hasRuntimeDisabledState(attributes.get('id'), bundle);
      const dynamicTemplateBinding = hasDynamicTemplateControlBinding(attributes, kind, bundle);
      const exactSelectorBinding = hasExactSelectorBinding(attributes, bundle, events);
      const explicit = passive || runtimeDisabled || inlineBinding || Boolean(actionMapped || dataMapped || formMapped || formClassMapped || direct || classBinding || delegatedBinding || scopedFormBinding || formReadback || dynamicTemplateBinding || exactSelectorBinding || navigation);
      const line = source.slice(0, match.index).split('\n').length;
      controls.push({
        file, line, kind, explicit, inScope: !NON_WORKFLOW_PAGES.has(file), feature: featureMarker,
        action: attributes.get('data-action') || attributes.get('data-completion-action') || attributes.get('data-completion-page') || '',
        tag: tag.slice(0, 180)
      });
    }
  }
  const inScope = controls.filter(control => control.inScope);
  return {
    total: controls.length,
    explicit: inScope.filter(control => control.explicit).length,
    excluded: controls.filter(control => !control.inScope).length,
    unmapped: inScope.filter(control => !control.explicit)
  };
}

export function evaluateFeatureGate(results, unknown, controlScan) {
  const failures = results.filter(result => result.status !== 'PASS').length;
  const gate = failures || unknown.length || controlScan.unmapped.length ? 'FAIL' : 'PASS';
  return { gate, failures, unknownMarkers: unknown.length, unmappedControls: controlScan.unmapped.length };
}

/** 输出功能契约检查结果并在 FAIL 或未注册标记时返回非零退出码。 */
export async function runFeatureAudit({ root = ROOT, write = line => process.stdout.write(`${line}\n`) } = {}) {
  const contracts = JSON.parse(await readFile(path.join(root, 'data', 'feature-contracts.json'), 'utf8'));
  const sources = await loadAuditSources(root);
  const results = auditContracts(contracts, sources);
  const unknown = findUnknownFeatureMarkers(sources, contracts);
  const controlScan = scanInteractiveControls(sources);
  write('FEATURE REPORT');
  for (const result of results) {
    write(`${result.featureId.padEnd(24)} ${result.status}${result.missing.length ? ` ${result.missing.join(', ')}` : ''}`);
  }
  write('CONTROL SCOPE application workflows; static marketing and documentation pages are inventoried separately');
  write(`INTERACTIVE CONTROLS scanned=${controlScan.total} mapped=${controlScan.explicit} needs_review=${controlScan.unmapped.length} out_of_scope=${controlScan.excluded}`);
  controlScan.unmapped.slice(0, 20).forEach(control => write(`UNMAPPED ${control.file}:${control.line} ${control.tag}`));
  if (controlScan.unmapped.length > 20) write(`UNMAPPED ... and ${controlScan.unmapped.length - 20} more`);
  if (unknown.length) write(`UNKNOWN_FEATURE_MARKERS ${unknown.join(', ')}`);
  const gateResult = evaluateFeatureGate(results, unknown, controlScan);
  write(`FEATURE GATE ${gateResult.gate} contracts=${results.length} failed_contracts=${gateResult.failures} unknown_markers=${gateResult.unknownMarkers} unmapped_controls=${gateResult.unmappedControls}`);
  return { results, unknown, controlScan, ...gateResult, exitCode: gateResult.gate === 'PASS' ? 0 : 1 };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  runFeatureAudit().then(result => { process.exitCode = result.exitCode; }).catch(error => {
    process.stderr.write(`FEATURE AUDIT ERROR: ${String(error && error.message || error)}\n`);
    process.exitCode = 1;
  });
}
