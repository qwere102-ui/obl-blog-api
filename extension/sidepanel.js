// ── Firebase 설정 ─────────────────────────────────────────────
// Firebase Console → 프로젝트 설정 → 일반 → 웹 API 키
const FIREBASE_WEB_API_KEY = 'AIzaSyA5PnhBcZf_TcGvH9vbPi26a6hWksLGwWs';
// Firebase Console → 프로젝트 설정 → 일반 → 프로젝트 ID
const FIREBASE_PROJECT_ID  = 'autoblog-9d026';

const CF_BASE = `https://us-central1-${FIREBASE_PROJECT_ID}.cloudfunctions.net`;

const AUTH_URL    = `https://identitytoolkit.googleapis.com/v1/accounts`;
const REFRESH_URL = `https://securetoken.googleapis.com/v1/token`;

const ENDPOINTS = {
  suggestTitles: `${CF_BASE}/bw_suggest_titles`,
  generate:      `${CF_BASE}/bw_generate`,
  generateImage: `${CF_BASE}/bw_generate_image`,
};

let token      = '';
let _abortCtrl = null;
let _pendingManuscript = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── 초기화 ─────────────────────────────────────────────── */
async function init() {
  const s = await chrome.storage.local.get(['bw_token','bw_email','bw_refresh','bw_token_exp']);
  if (s.bw_token) {
    token = s.bw_token;
    // 토큰 만료 10분 전이면 자동 갱신
    if (s.bw_refresh && s.bw_token_exp && (s.bw_token_exp - Date.now() < 10 * 60 * 1000)) {
      try { await refreshIdToken(s.bw_refresh); } catch {}
    }
    $('status-text').textContent = s.bw_email || '';
    showPage('main');
  } else {
    showPage('auth');
  }
  bindEvents();
}

/* ── 토큰 갱신 ──────────────────────────────────────────── */
async function refreshIdToken(refreshToken) {
  const r = await fetch(`${REFRESH_URL}?key=${FIREBASE_WEB_API_KEY}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({grant_type: 'refresh_token', refresh_token: refreshToken}),
  });
  if (!r.ok) throw new Error('토큰 갱신 실패');
  const d = await r.json();
  token = d.id_token;
  await chrome.storage.local.set({
    bw_token:     d.id_token,
    bw_refresh:   d.refresh_token,
    bw_token_exp: Date.now() + parseInt(d.expires_in, 10) * 1000,
  });
}

async function ensureFreshToken() {
  const s = await chrome.storage.local.get(['bw_refresh','bw_token_exp']);
  if (s.bw_refresh && s.bw_token_exp && (s.bw_token_exp - Date.now() < 5 * 60 * 1000)) {
    await refreshIdToken(s.bw_refresh);
  }
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
  await ensureFreshToken();
  const h = {'Content-Type': 'application/json'};
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetch(url, {method, headers: h, body: body ? JSON.stringify(body) : undefined, signal});
  const text = await r.text();
  let d; try { d = JSON.parse(text); } catch { throw new Error(`서버 오류 (${r.status})`); }
  if (!r.ok) throw new Error(d.error || d.detail || `서버 오류 (${r.status})`);
  return d;
}

/* ── 인증 ─────────────────────────────────────────────────── */
async function doLogin() {
  const email = v('a-email'), pw = v('a-pw');
  if (!email || !pw) return toast('이메일과 비밀번호를 입력해주세요', 'err');
  try {
    const r = await fetch(`${AUTH_URL}:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email, password: pw, returnSecureToken: true}),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || '로그인 실패');
    token = d.idToken;
    await chrome.storage.local.set({
      bw_token:     d.idToken,
      bw_email:     email,
      bw_refresh:   d.refreshToken,
      bw_token_exp: Date.now() + parseInt(d.expiresIn, 10) * 1000,
    });
    $('status-text').textContent = email;
    showPage('main');
    toast('로그인되었습니다', 'ok');
  } catch(e) { toast(e.message, 'err'); }
}

async function doSignup() {
  const email = v('a-email'), pw = v('a-pw');
  if (!email || !pw) return toast('이메일과 비밀번호를 입력해주세요', 'err');
  if (pw.length < 6) return toast('비밀번호 6자 이상 필요', 'err');
  try {
    const r = await fetch(`${AUTH_URL}:signUp?key=${FIREBASE_WEB_API_KEY}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email, password: pw, returnSecureToken: true}),
    });
    const d = await r.json();
    if (!r.ok) {
      const msg = d.error?.message || '';
      if (msg === 'EMAIL_EXISTS') throw new Error('이미 사용 중인 이메일입니다');
      if (msg === 'WEAK_PASSWORD') throw new Error('비밀번호 6자 이상 필요');
      throw new Error('회원가입 실패: ' + msg);
    }
    token = d.idToken;
    await chrome.storage.local.set({
      bw_token:     d.idToken,
      bw_email:     email,
      bw_refresh:   d.refreshToken,
      bw_token_exp: Date.now() + parseInt(d.expiresIn, 10) * 1000,
    });
    $('status-text').textContent = email;
    showPage('main');
    toast('회원가입 완료!', 'ok');
  } catch(e) { toast(e.message, 'err'); }
}

async function doLogout() {
  token = '';
  await chrome.storage.local.remove(['bw_token','bw_email','bw_refresh','bw_token_exp']);
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
    // 1. 네이버 블로그 작성 탭 열기
    showLoading('네이버 블로그 작성 탭 열기...');
    const writeTab = await openWriteTab();

    // 2. AI 원고 생성
    showLoading('Gemini AI 원고 생성 중... (30~60초)');
    const d = await apiFetch('POST', ENDPOINTS.generate, {
      topic,
      keyword: kw,
      job_type: v('f-type') || '정보/설명글',
      target_audience: v('f-aud') || '60대 성인',
      extra_instructions: v('f-extra') || '',
    }, _abortCtrl.signal);

    // 3. 커스텀 제목 우선 적용
    const customTitle = v('f-title');
    if (customTitle) d.title = customTitle;

    // 4. 미리보기 표시
    _pendingManuscript = {data: d, tabId: writeTab.id};
    showPreview(d);

  } catch(e) {
    if (e.name === 'AbortError') {
      // stopGenerate()에서 처리
    } else {
      showPage('main');
      if (e.message.includes('401') || e.message.includes('인증')) {
        token = '';
        await chrome.storage.local.remove(['bw_token','bw_email','bw_refresh','bw_token_exp']);
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
