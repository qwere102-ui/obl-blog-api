// BlogWriter content.js — 네이버 블로그 에디터 삽입 전용

const sleep = ms => new Promise(r => setTimeout(r, ms));
let aborted = false;

/* ── 진입점 A: 페이지 로드 시 bw_pending 확인 ────────────── */
(async () => {
  if (!location.href.includes('blog.naver.com')) return;
  const isWrite = await waitForEditor(12000);
  if (!isWrite) return;
  const {bw_pending} = await chrome.storage.local.get('bw_pending');
  if (!bw_pending) return;
  await chrome.storage.local.remove('bw_pending');
  doInsert(bw_pending);
})();

/* ── 진입점 B: 사이드 패널에서 메시지 수신 ─────────────────── */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'BW_ABORT') {
    aborted = true;
    showStatus('생성이 중단되었습니다', 'error');
    return;
  }
  if (msg.type !== 'BW_INSERT_NOW') return;
  aborted = false;
  chrome.storage.local.get('bw_pending').then(async ({bw_pending}) => {
    if (!bw_pending) return;
    await chrome.storage.local.remove('bw_pending');
    doInsert(bw_pending);
  });
});

/* ── 에디터 DOM 대기 ─────────────────────────────────────── */
async function waitForEditor(timeout) {
  const t = Date.now();
  while (Date.now() - t < timeout) {
    if (findEditors().body) return true;
    await sleep(600);
  }
  return false;
}

/* ── 상태 오버레이 ───────────────────────────────────────── */
function showStatus(msg, type = 'progress') {
  let el = document.getElementById('bw-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bw-status';
    el.style.cssText =
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);' +
      'z-index:2147483647;padding:10px 24px;border-radius:40px;' +
      'font-size:14px;font-weight:700;color:#fff;pointer-events:none;' +
      "font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;" +
      'box-shadow:0 4px 20px rgba(0,0,0,.25);white-space:nowrap;transition:opacity .4s;';
    document.body.appendChild(el);
  }
  el.style.opacity = '1';
  el.style.background = type === 'done' ? '#10b981' : type === 'error' ? '#ef4444' : type === 'warn' ? '#f59e0b' : '#2563eb';
  el.textContent = (type === 'done' ? '✅' : type === 'error' ? '❌' : type === 'warn' ? '⚠️' : '⏳') + ' ' + msg;
  if (type === 'done' || type === 'error') {
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, 5000);
  }
}

/* ── 에디터 탐색 ─────────────────────────────────────────── */
function scanDoc(doc) {
  const TITLE_SELS = [
    '.se-documentTitle-inputArea[contenteditable]',
    '.se-title-input[contenteditable]',
    '[data-placeholder*="제목"][contenteditable]',
    'input[placeholder*="제목"]',
    'input[name="subject"]',
    '#subject',
  ];
  let title = null;
  for (const s of TITLE_SELS) {
    title = doc.querySelector(s);
    if (title) break;
  }
  let body = null;
  const cont = doc.querySelector('.se-main-container');
  if (cont) {
    if (cont.getAttribute('contenteditable') === 'true') {
      body = cont;
    } else {
      for (const ce of cont.querySelectorAll('[contenteditable="true"]')) {
        if (!ce.closest('.se-documentTitle')) { body = ce; break; }
      }
    }
  }
  if (!body) {
    for (const ce of doc.querySelectorAll('[contenteditable="true"]')) {
      if (ce === title) continue;
      if (ce.closest('.se-documentTitle')) continue;
      if (/title|subject/i.test(ce.id || '')) continue;
      body = ce; break;
    }
  }
  if (!body) body = doc.querySelector('#se_text_editor, .se2_inputarea');
  return {title, body};
}

function findEditors() {
  const main = scanDoc(document);
  if (main.title && main.body) return main;
  for (const fr of document.querySelectorAll('iframe')) {
    try {
      const d = fr.contentDocument || fr.contentWindow?.document;
      if (!d) continue;
      const r = scanDoc(d);
      return {title: main.title || r.title, body: main.body || r.body};
    } catch {}
  }
  return main;
}

async function waitEditors(timeout = 20000) {
  const t = Date.now();
  while (Date.now() - t < timeout) {
    const r = findEditors(); if (r.body) return r;
    await sleep(600);
  }
  return {title: null, body: null};
}

/* ── 제목 삽입 ───────────────────────────────────────────── */
async function writeTitle(el, text) {
  // INPUT/TEXTAREA (일반 입력창)
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    el.click(); el.focus(); await sleep(200);
    const win = el.ownerDocument.defaultView;
    const proto = el.tagName === 'INPUT'
      ? win.HTMLInputElement.prototype
      : win.HTMLTextAreaElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, text); else el.value = text;
    el.dispatchEvent(new win.Event('input',  {bubbles: true}));
    el.dispatchEvent(new win.Event('change', {bubbles: true}));
    return;
  }

  // contenteditable (SmartEditor ONE 제목 영역)
  const doc = el.ownerDocument;
  const win = doc.defaultView;

  // 1단계: 기존 내용 전체 선택 후 ClipboardEvent로 교체 (plain text only)
  el.click(); await sleep(150); el.focus(); await sleep(200);

  const range = doc.createRange();
  range.selectNodeContents(el);
  const sel = win.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  await sleep(80);

  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
  await sleep(300);
  if (titleHas(el, text)) return;

  // 2단계: 전체 삭제 후 execCommand insertText
  el.focus(); await sleep(100);
  const r2 = doc.createRange();
  r2.selectNodeContents(el);
  sel.removeAllRanges(); sel.addRange(r2);
  doc.execCommand('delete', false, null); await sleep(80);
  doc.execCommand('insertText', false, text); await sleep(150);
  if (titleHas(el, text)) return;

  // 3단계: InputEvent (React beforeinput 트리거)
  el.focus(); await sleep(100);
  while (el.firstChild) el.removeChild(el.firstChild);
  const tn = doc.createTextNode(text);
  el.appendChild(tn);
  el.dispatchEvent(new win.InputEvent('beforeinput', {inputType:'insertText', data:text, bubbles:true, cancelable:true}));
  el.dispatchEvent(new win.InputEvent('input',       {inputType:'insertText', data:text, bubbles:true}));
}

function titleHas(el, text) {
  return el.textContent.replace(/\s/g,'').includes(text.slice(0,6).replace(/\s/g,''));
}

/* ── 본문 텍스트 삽입 ──────────────────────────────────────── */
async function pasteContent(el, plainText, html) {
  const doc = el.ownerDocument, win = doc.defaultView;
  el.click(); el.focus(); await sleep(80);

  // 커서를 끝으로 이동
  const range = doc.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = win.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const dt = new DataTransfer();
  dt.setData('text/plain', plainText);
  dt.setData('text/html', html);
  el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
  await sleep(200);

  if (plainText && !el.textContent.includes(plainText.slice(0, 10))) {
    sel.removeAllRanges();
    sel.addRange(range);
    if (!doc.execCommand('insertHTML', false, html)) {
      if (!doc.execCommand('insertText', false, plainText)) {
        el.innerHTML += html;
        el.dispatchEvent(new win.Event('input', {bubbles: true}));
      }
    }
  }
}

/* ── SmartEditor ONE에 Enter 키 눌러 단락 구분 ─────────────── */
async function pressEnter(el) {
  const doc = el.ownerDocument;
  el.focus(); await sleep(40);
  // SmartEditor ONE은 keydown Enter 로 새 단락(p) 생성
  el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true}));
  await sleep(40);
  el.dispatchEvent(new KeyboardEvent('keyup',   {key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true}));
  // execCommand 폴백 (일부 브라우저)
  doc.execCommand('insertParagraph', false, null);
  await sleep(80);
}

/* ── 이미지 플레이스홀더 삽입 ────────────────────────────── */
const IMG_MARK = (n) => `【BW이미지${n}자리】`;

async function insertPlaceholder(el, num) {
  const mark = IMG_MARK(num);
  const html = `<p style="text-align:center;background:#eff6ff;border:2px dashed #93c5fd;` +
    `border-radius:10px;padding:20px 16px;margin:12px 0;color:#1d4ed8;font-size:13px;font-weight:700">` +
    `🎨 이미지 ${num} 생성 중...${mark}</p>`;
  await pasteContent(el, mark, html);
  await sleep(200);
}

/* ── 플레이스홀더를 이미지로 교체 ───────────────────────────── */
async function replacePlaceholderWithImage(body, num, file) {
  const doc = body.ownerDocument;
  const win = doc.defaultView;
  const mark = IMG_MARK(num);

  // 텍스트 노드에서 마커 탐색
  let targetEl = null;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (walker.currentNode.textContent.includes(mark)) {
      targetEl = walker.currentNode.parentElement;
      break;
    }
  }
  if (!targetEl) {
    // 마커를 못 찾으면 body 끝에 추가
    await pasteImageAtEnd(body, file, num);
    return;
  }

  // 플레이스홀더 단락 전체 선택 후 이미지 파일로 교체
  const p = targetEl.closest('p') || targetEl;
  const range = doc.createRange();
  range.selectNode(p);
  win.getSelection().removeAllRanges();
  win.getSelection().addRange(range);

  const dt = new DataTransfer();
  dt.items.add(file);
  body.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
  await sleep(3000); // 네이버 업로드 대기
}

async function pasteImageAtEnd(body, file, num) {
  const doc = body.ownerDocument, win = doc.defaultView;
  body.click(); body.focus(); await sleep(100);
  const range = doc.createRange();
  range.selectNodeContents(body);
  range.collapse(false);
  win.getSelection().removeAllRanges();
  win.getSelection().addRange(range);
  const dt = new DataTransfer();
  dt.items.add(file);
  body.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
  await sleep(3000);
}

/* ── 이미지 생성 (재시도 포함) ───────────────────────────── */
function generateImageOnce(prompt, token) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      {type: 'BW_GENERATE_IMAGE', prompt, token},
      resp => {
        if (chrome.runtime.lastError) {
          console.warn('[BW content] sendMessage 오류:', chrome.runtime.lastError.message);
          resolve(null);
        } else if (!resp?.ok) {
          console.warn('[BW content] 이미지 실패:', resp?.error);
          resolve(null);
        } else {
          resolve(resp.data);
        }
      }
    );
  });
}

async function generateImage(prompt, token) {
  // 1차 시도
  let result = await Promise.race([
    generateImageOnce(prompt, token),
    new Promise(r => setTimeout(() => r(null), 70000))
  ]);
  if (result) return result;
  // 2차 재시도 (3초 대기 후)
  console.warn('[BW content] 이미지 재시도...');
  await sleep(3000);
  result = await Promise.race([
    generateImageOnce(prompt, token),
    new Promise(r => setTimeout(() => r(null), 70000))
  ]);
  return result;
}

function dataUrlToFile(dataUrl, filename) {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, {type: mime});
}

/* ── 본문 파싱 ───────────────────────────────────────────── */
function parseSegments(bodyText) {
  const segs = [], re = /\[이미지\s*(\d*)\s*:\s*([^\]]+)\]/g;
  let last = 0, n = 1, m;
  while ((m = re.exec(bodyText)) !== null) {
    const t = bodyText.slice(last, m.index).trim();
    if (t) segs.push({type: 'text', content: t});
    segs.push({type: 'image', prompt: m[2].trim(), num: parseInt(m[1]) || n});
    n++; last = m.index + m[0].length;
  }
  const rest = bodyText.slice(last).trim();
  if (rest) segs.push({type: 'text', content: rest});
  return segs;
}

/* ── 텍스트 → HTML (블로그형 서식) ─────────────────────── */
function textToHtml(text) {
  return text.split(/\n\n+/)
    .filter(p => p.trim())
    .map(p => {
      const line = p.trim();
      // 소제목 패턴: "■ 소제목" 또는 "① ②" 등
      if (/^[■▶✔※①②③④⑤]/.test(line) || /^(첫째|둘째|셋째|넷째|다섯째)[,.、]/.test(line)) {
        return `<p style="font-weight:700;font-size:14px;color:#1e40af;margin:16px 0 6px">${escHtml(line)}</p>`;
      }
      // 일반 단락
      return `<p style="line-height:1.9;margin:0 0 14px;word-break:keep-all">${
        line.replace(/\n/g, '<br>').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      }</p>`;
    })
    .join('');
}

function hashtagsToHtml(tags) {
  if (!tags || !tags.length) return '';
  const items = tags.map(t => {
    const tag = t.startsWith('#') ? t : '#' + t;
    return `<span style="color:#2563eb">${escHtml(tag)}</span>`;
  }).join('<span style="color:#94a3b8">, </span>');
  return `<p style="margin-top:24px;line-height:2;word-break:break-all">${items}</p>`;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── 메인 삽입 흐름 ──────────────────────────────────────── */
async function doInsert(ms) {
  showStatus('에디터 탐색 중...');

  const {bw_token: token} = await chrome.storage.local.get('bw_token');
  const {title: titleEl, body} = await waitEditors();

  if (!body) {
    showStatus('에디터를 찾지 못했습니다', 'error');
    try { await navigator.clipboard.writeText(ms.title + '\n\n' + ms.body); } catch {}
    setTimeout(() => alert('[오블] 에디터를 찾지 못했습니다.\n내용이 클립보드에 복사됐습니다.\n에디터 클릭 후 Ctrl+V 해주세요.'), 200);
    return;
  }

  const segs = parseSegments(ms.body);
  const imgSegs = segs.filter(s => s.type === 'image');

  // ── 1. 이미지 순차 생성 (병렬 시 Pollinations 제한 → 순차로 변경) ──
  const imgMap = new Map(); // num → File
  for (let i = 0; i < imgSegs.length; i++) {
    if (aborted) { showStatus('생성이 중단되었습니다', 'error'); return; }
    const seg = imgSegs[i];
    showStatus(`이미지 생성 중... (${i + 1}/${imgSegs.length}) — 잠시 기다려주세요`);
    const base64 = await generateImage(seg.prompt, token);
    if (aborted) { showStatus('생성이 중단되었습니다', 'error'); return; }
    if (base64) {
      imgMap.set(seg.num, dataUrlToFile(base64, `blogimage_${seg.num}.png`));
    } else {
      showStatus(`⚠️ 이미지 ${i + 1} 생성 실패 — 건너뜀`, 'warn');
      await sleep(1000);
    }
  }

  if (aborted) { showStatus('생성이 중단되었습니다', 'error'); return; }

  // ── 2. 제목 삽입 ────────────────────────────────────────
  if (titleEl) {
    showStatus('제목 입력 중...');
    await writeTitle(titleEl, ms.title);
    await sleep(500);
  }

  // ── 3. 본문 초기화 ──────────────────────────────────────
  showStatus('본문 초기화...');
  const doc = body.ownerDocument, win = doc.defaultView;
  body.click(); body.focus(); await sleep(150);
  const rAll = doc.createRange();
  rAll.selectNodeContents(body);
  win.getSelection().removeAllRanges();
  win.getSelection().addRange(rAll);
  if (!doc.execCommand('delete', false, null)) {
    body.innerHTML = '';
    body.dispatchEvent(new Event('input', {bubbles: true}));
  }
  await sleep(400);

  // ── 4. 단락 + 이미지 순서대로 삽입 ──────────────────────
  let textIdx = 0, imgIdx = 0;
  for (const seg of segs) {
    if (aborted) { showStatus('생성이 중단되었습니다', 'error'); return; }

    if (seg.type === 'text') {
      textIdx++;
      const paras = seg.content.split(/\n\n+/).filter(p => p.trim());
      for (let j = 0; j < paras.length; j++) {
        if (aborted) { showStatus('생성이 중단되었습니다', 'error'); return; }
        showStatus(`본문 작성 중... (텍스트 ${textIdx}/${segs.filter(s=>s.type==='text').length} · 단락 ${j+1}/${paras.length})`);
        const para = paras[j].trim();
        const isHeading = /^[■▶✔※①②③④⑤]/.test(para) || /^(첫째|둘째|셋째|넷째|다섯째)[,.、]/.test(para);
        const pHtml = isHeading
          ? `<p style="font-weight:700;font-size:14px;color:#1e40af;margin:16px 0 6px">${escHtml(para)}</p>`
          : `<p style="line-height:1.9;margin:0 0 14px;word-break:keep-all">${escHtml(para).replace(/\n/g,'<br>')}</p>`;
        await pasteContent(body, para, pHtml);
        // 단락 사이 Enter → SmartEditor ONE이 새 <p> 생성 (띄어쓰기)
        await pressEnter(body);
        await sleep(150);
      }

    } else {
      imgIdx++;
      const file = imgMap.get(seg.num);
      if (!file) {
        showStatus(`이미지 ${seg.num} 생성 실패 (건너뜀)`, 'error');
        await sleep(800);
        continue;
      }
      showStatus(`이미지 ${imgIdx}/${imgSegs.length} 삽입 중...`);
      await pasteImageAtEnd(body, file, seg.num);
      await sleep(2000); // 네이버 업로드 완료 대기
    }
  }

  // ── 5. 해시태그 삽입 ────────────────────────────────────
  const tags = ms.hashtags || [];
  if (tags.length) {
    if (aborted) { showStatus('생성이 중단되었습니다', 'error'); return; }
    showStatus(`해시태그 ${tags.length}개 삽입 중...`);
    await pasteContent(body, tags.map(t => t.startsWith('#') ? t : '#'+t).join(', '), hashtagsToHtml(tags));
    await sleep(200);
  }

  showStatus(`완료! 제목·본문·이미지 ${imgMap.size}개·해시태그 ${tags.length}개 삽입됨`, 'done');
}
