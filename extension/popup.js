// Firebase 배포 후 아래 URL을 실제 Function URL로 교체하세요
const ENDPOINTS = {
  signup:        'http://127.0.0.1:8000/auth/signup',
  login:         'http://127.0.0.1:8000/auth/login',
  me:            'http://127.0.0.1:8000/auth/me',
  generate:      'http://127.0.0.1:8000/manuscripts/generate',
  generateImage: 'http://127.0.0.1:8000/manuscripts/generate-image',
};

let token = '';
let currentManuscript = null;

// ── 초기화 ──────────────────────────────────────────────────
async function init() {
  const stored = await chrome.storage.local.get(['bw_token', 'bw_email']);
  token = stored.bw_token || '';
  if (token) {
    try {
      await apiFetch('GET', ENDPOINTS.me);
      showPage('main');
      setStatus(stored.bw_email || '');
    } catch {
      token = '';
      showPage('auth');
    }
  } else {
    showPage('auth');
  }
  checkServer();
  bindEvents();
}

async function checkServer() {
  try {
    await fetch(ENDPOINTS.me, {method: 'GET'});
    document.getElementById('server-warn').style.display = 'none';
  } catch {
    document.getElementById('server-warn').style.display = 'block';
  }
}

function bindEvents() {
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('btn-signup-link').addEventListener('click', doSignup);
  document.getElementById('a-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('btn-generate').addEventListener('click', generate);
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  document.getElementById('btn-back').addEventListener('click', goBack);
}

// ── 페이지 전환 ─────────────────────────────────────────────
function showPage(name) {
  ['auth', 'main', 'done'].forEach(p => {
    document.getElementById('page-' + p).classList.toggle('on', p === name);
  });
  document.getElementById('loading').classList.remove('on');
}

function setStatus(email) {
  document.getElementById('status-text').textContent = email ? `● ${email}` : '';
}

function goBack() {
  showPage('main');
  currentManuscript = null;
}

// ── API ─────────────────────────────────────────────────────
async function apiFetch(method, url, body) {
  const h = {'Content-Type': 'application/json'};
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetch(url, {method, headers: h, body: body ? JSON.stringify(body) : undefined});
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); } catch { throw new Error(`서버 오류 (${r.status})`); }
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
  let d;
  try { d = JSON.parse(text); } catch { throw new Error(`서버 오류 (${r.status})`); }
  if (!r.ok) throw new Error(d.detail || `서버 오류 (${r.status})`);
  return d;
}

// ── 인증 ────────────────────────────────────────────────────
async function doLogin() {
  const email = v('a-email'), pw = v('a-pw');
  if (!email || !pw) return toast('이메일과 비밀번호를 입력해주세요', 'err');
  try {
    const d = await apiFetchForm(ENDPOINTS.login, {username: email, password: pw});
    token = d.access_token;
    await chrome.storage.local.set({bw_token: token, bw_email: email});
    setStatus(email);
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
    setStatus(email);
    showPage('main');
    toast('회원가입 완료', 'ok');
  } catch(e) { toast(e.message, 'err'); }
}

async function doLogout() {
  token = '';
  await chrome.storage.local.remove(['bw_token', 'bw_email']);
  showPage('auth');
  setStatus('');
}

// ── 원고 생성 → 네이버 탭 오픈 ───────────────────────────────
async function generate() {
  const topic = v('f-topic'), kw = v('f-kw');
  if (!topic || !kw) return toast('주제와 키워드를 입력해주세요', 'err');
  const btn = document.getElementById('btn-generate');
  btn.disabled = true;
  document.getElementById('page-main').classList.remove('on');
  document.getElementById('loading').classList.add('on');
  try {
    const d = await apiFetch('POST', ENDPOINTS.generate, {
      topic, keyword: kw,
      job_type: v('f-type'),
      target_audience: v('f-aud') || '60대 성인',
      extra_instructions: v('f-extra') || '',
      generate_image: false
    });
    currentManuscript = d;

    // 원고를 storage에 저장 → content.js가 읽어서 삽입
    await chrome.storage.local.set({bw_pending: d});

    // 네이버 블로그 작성 탭 열기
    chrome.tabs.create({url: 'https://blog.naver.com/PostWriteForm.naver'});

    showPage('done');
    toast('네이버 블로그 탭에서 삽입 중입니다!', 'ok');
  } catch(e) {
    showPage('main');
    toast(e.message, 'err');
  }
  btn.disabled = false;
}

// ── 유틸 ────────────────────────────────────────────────────
function v(id) { return (document.getElementById(id)?.value || '').trim(); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

let _tt;
function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast on' + (type ? ' ' + type : '');
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove('on'), 3000);
}

init();
