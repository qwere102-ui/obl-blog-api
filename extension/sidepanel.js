const BACKEND = 'https://obl-blog-api.onrender.com';

const ENDPOINTS = {
  signup:        `${BACKEND}/auth/signup`,
  login:         `${BACKEND}/auth/login`,
  me:            `${BACKEND}/auth/me`,
  generate:      `${BACKEND}/manuscripts/generate`,
  suggestTitles: `${BACKEND}/manuscripts/suggest-titles`,
};

let token = '';
let _abortCtrl = null;
let _pendingManuscript = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── 초기화 ─────────────────────────────────────────────── */
async function init() {
  const s = await chrome.storage.local.get(['bw_token', 'bw_email']);
  token = s.bw_token || '';
  if (token) {
    $('status-text').textContent = s.bw_email || '';
    showPage('main');
  } else {
    showPage('auth');
  }
  bindEvents();
}

function bindEvents() {
  $('btn-login').addEventListener('click', doLogin);
  $('btn-signup-link').addEventListener('click', doSignup);
  $('a-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('btn-suggest').addEventListener('click', suggestTitles);
  $('btn-generate').addEventListener('click', generate);
  $('btn-stop').addEventListener('click', stopGenerate);
  $('btn-insert').addEventListener('click', insertToNaver);
  $('btn-regenerate').addEventListener('click', () => { _pendingManuscript = null; showPage('main'); });
  $('btn-logout').addEventListener('click', doLogout);
  $('btn-new').addEventListener('click', () => showPage('main'));
}

/* ── 페이지 전환 ─────────────────────────────────────────── */
function showPage(name) {
  ['auth','main','preview','done'].forEach(p =>
    $('page-' + p).classList.toggle('on', p === name)
  );
  $('loading').classList.remove('on');
}

function showLoading(step) {
  ['auth','main','done'].forEach(p => $('page-' + p).classList.remove('on'));
  $('loading').classList.add('on');
  $('loading-step').textContent = step || '';
}

/* ── API ─────────────────────────────────────────────────── */
async function apiFetch(method, url, body, signal) {
  const h = {'Content-Type': 'application/json'};
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetch(url, {method, headers: h, body: body ? JSON.stringify(body) : undefined, signal});
  const text = await r.text();
  let d; try { d = JSON.parse(text); } catch { throw new Error(`서버 오류 (${r.status})`); }
  if (!r.ok) throw new Error(d.detail || `서버 오류 (${r.status})`);
  return d;
}

async function apiFetchForm(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams(body)
  });
  const text = await r.text();
  let d; try { d = JSON.parse(text); } catch { throw new Error(`서버 오류 (${r.status})`); }
  if (!r.ok) throw new Error(d.detail || `서버 오류 (${r.status})`);
  return d;
}

/* ── 인증 ─────────────────────────────────────────────────── */
async function doLogin() {
  const email = v('a-email'), pw = v('a-pw');
  if (!email || !pw) return toast('이메일과 비밀번호를 입력해주세요', 'err');
  try {
    const d = await apiFetchForm(ENDPOINTS.login, {username: email, password: pw});
    token = d.access_token;
    await chrome.storage.local.set({bw_token: token, bw_email: email});
    $('status-text').textContent = email;
    showPage('main');
    toast('로그인되었습니다', 'ok');
  } catch(e) { toast(e.message, 'err'); }
}

async function doSignup() {
  const email = v('a-email'), pw = v('a-pw');
  if (!email || !pw) return toast('이메일과 비밀번호를 입력해주세요', 'err');
  try {
    const d = await apiFetch('POST', ENDPOINTS.signup, {email, password: pw});
    token = d.access_token;
    await chrome.storage.local.set({bw_token: token, bw_email: email});
    $('status-text').textContent = email;
    showPage('main');
    toast('회원가입 완료', 'ok');
  } catch(e) { toast(e.message, 'err'); }
}

async function doLogout() {
  token = '';
  await chrome.storage.local.remove(['bw_token', 'bw_email']);
  $('status-text').textContent = '오늘의블로그 AI 원고 자동 생성';
  showPage('auth');
}

/* ── 제목 추천 ──────────────────────────────────────────── */
async function suggestTitles() {
  const topic = v('f-topic'), kw = v('f-kw');
  if (!topic || !kw) return toast('주제와 키워드를 먼저 입력해주세요', 'err');

  const btn = $('btn-suggest');
  btn.disabled = true;
  btn.textContent = '생성 중...';

  const sugArea = $('sug-area');
  const sugList = $('sug-list');
  sugArea.style.display = '';
  sugList.innerHTML = '<div class="sug-loading">⏳ AI가 제목 5개를 추천 중...</div>';

  try {
    const d = await apiFetch('POST', ENDPOINTS.suggestTitles, {
      topic,
      keyword: kw,
      job_type: v('f-type') || '정보/설명글',
      target_audience: v('f-aud') || '60대 성인',
      current_title: v('f-title'),
    });

    const titles = d.titles || [];
    if (!titles.length) throw new Error('추천 결과 없음');

    sugList.innerHTML = '';
    titles.forEach(title => {
      const item = document.createElement('div');
      item.className = 'sug-item';
      item.textContent = title;
      item.addEventListener('click', () => {
        sugList.querySelectorAll('.sug-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        $('f-title').value = title;
      });
      sugList.appendChild(item);
    });
  } catch(e) {
    sugList.innerHTML = `<div class="sug-loading" style="color:#ef4444">⚠️ ${e.message}</div>`;
  }

  btn.disabled = false;
  btn.textContent = '✨ 추천';
}

/* ── 생성 중단 ──────────────────────────────────────────── */
async function stopGenerate() {
  if (_abortCtrl) _abortCtrl.abort();
  await chrome.storage.local.set({bw_abort: true});
  try {
    const tabs = await chrome.tabs.query({url: '*://blog.naver.com/*'});
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {type: 'BW_ABORT'}).catch(() => {});
    }
  } catch {}
  showPage('main');
  toast('생성을 중단했습니다', 'err');
  $('btn-generate').disabled = false;
}

/* ── 원고 생성 & 자동 삽입 ──────────────────────────────── */
async function generate() {
  const topic = v('f-topic'), kw = v('f-kw');
  if (!topic || !kw) return toast('주제와 키워드를 입력해주세요', 'err');

  $('btn-generate').disabled = true;
  _abortCtrl = new AbortController();
  await chrome.storage.local.remove('bw_abort');

  try {
    showLoading('네이버 블로그 작성 탭 열기...');
    const writeTab = await openWriteTab();

    showLoading('Gemini AI 원고 생성 중... (30~60초)');
    const d = await apiFetch('POST', ENDPOINTS.generate, {
      topic,
      keyword: kw,
      job_type: v('f-type') || '정보/설명글',
      target_audience: v('f-aud') || '60대 성인',
      extra_instructions: v('f-extra') || '',
      generate_image: false,
    }, _abortCtrl.signal);

    const customTitle = v('f-title');
    if (customTitle) d.title = customTitle;

    _pendingManuscript = {data: d, tabId: writeTab.id};
    showPreview(d);

  } catch(e) {
    if (e.name === 'AbortError') {
      // stopGenerate()에서 처리
    } else {
      showPage('main');
      if (e.message.includes('401')) {
        token = '';
        await chrome.storage.local.remove(['bw_token','bw_email']);
        showPage('auth');
        toast('세션 만료 — 다시 로그인해주세요', 'err');
      } else {
        toast(e.message, 'err');
      }
    }
  } finally {
    _abortCtrl = null;
    $('btn-generate').disabled = false;
  }
}

/* ── 미리보기 표시 ──────────────────────────────────────── */
function showPreview(d) {
  const imgCount = (d.body.match(/\[이미지\s*\d*\s*:/g) || []).length;
  const charCount = d.body.replace(/\[이미지[^\]]+\]/g, '').length;
  const tags = d.hashtags || [];

  $('preview-title').textContent = d.title;
  $('preview-body').textContent = d.body.replace(/\[이미지[^\]]+\]/g, '[이미지]').slice(0, 500) + (charCount > 500 ? '...' : '');
  $('preview-img-count').textContent = `🖼 이미지 ${imgCount}개`;
  $('preview-char-count').textContent = `📝 ${charCount}자`;
  $('preview-tag-count').textContent = `# 해시태그 ${tags.length}개`;
  $('preview-tags').textContent = tags.map(t => t.startsWith('#') ? t : '#' + t).join(' ');
  showPage('preview');
}

/* ── 네이버 블로그에 삽입 ────────────────────────────────── */
async function insertToNaver() {
  if (!_pendingManuscript) return;
  const {data: d, tabId} = _pendingManuscript;

  showLoading('블로그 에디터에 전달 중...');
  await chrome.storage.local.set({bw_pending: d, bw_abort: false});

  await waitTabLoaded(tabId, 20000);
  try {
    await chrome.tabs.sendMessage(tabId, {type: 'BW_INSERT_NOW'});
  } catch {}

  $('done-title-preview').textContent = '📝 ' + d.title;
  showPage('done');
  toast('블로그 삽입 시작!', 'ok');
  _pendingManuscript = null;
}

/* 작성 탭 열기 or 포커스 */
async function openWriteTab() {
  const tabs = await chrome.tabs.query({url: '*://blog.naver.com/*'});
  const existing = tabs.find(t => /PostWrite|postwrite|PostModify|GoBlogWrite/i.test(t.url || ''));
  if (existing) {
    await chrome.tabs.update(existing.id, {active: true});
    return existing;
  }
  return await chrome.tabs.create({url: 'https://blog.naver.com/GoBlogWrite.naver'});
}

/* 탭 로딩 완료 대기 */
async function waitTabLoaded(tabId, timeout) {
  const t = Date.now();
  while (Date.now() - t < timeout) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return;
    } catch { return; }
    await sleep(500);
  }
}

/* ── 유틸 ────────────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }
function v(id) { return ($( id)?.value || '').trim(); }

let _tt;
function toast(msg, type) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast on' + (type ? ' ' + type : '');
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove('on'), 3000);
}

init();
