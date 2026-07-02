// 아이콘 클릭 시 Side Panel 열기
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true});
});

// ── Firebase 설정 (sidepanel.js와 동일하게 맞춰주세요) ───────
const FIREBASE_PROJECT_ID = 'autoblog-9d026';
const CF_BASE = `https://us-central1-${FIREBASE_PROJECT_ID}.cloudfunctions.net`;

// 서비스 워커 keepalive — 이미지 생성 중 종료 방지
let _kaTimer = null;
function startKeepalive() {
  if (_kaTimer) return;
  _kaTimer = setInterval(() => chrome.storage.local.get('_ka', () => {}), 20000);
}
function stopKeepalive() {
  if (_kaTimer) { clearInterval(_kaTimer); _kaTimer = null; }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── keepalive ping ────────────────────────────────────────
  if (msg.type === 'BW_PING') {
    sendResponse({ok: true});
    return false;
  }

  // ── 임의 URL → base64 ────────────────────────────────────
  if (msg.type === 'BW_FETCH_IMAGE') {
    fetch(msg.url)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(blob => {
        const reader = new FileReader();
        reader.onload  = () => sendResponse({ok: true,  data: reader.result});
        reader.onerror = () => sendResponse({ok: false, error: 'FileReader 오류'});
        reader.readAsDataURL(blob);
      })
      .catch(e => { console.error('[오블] BW_FETCH_IMAGE 실패:', e.message); sendResponse({ok: false, error: e.message}); });
    return true;
  }

  // ── 이미지 생성 (Gemini 2.5 Flash Image) ─────────────────
  if (msg.type === 'BW_GENERATE_IMAGE') {
    startKeepalive();
    console.log('[오블] 이미지 생성 시작:', msg.prompt?.slice(0, 60));

    fetch(`${CF_BASE}/bw_generate_image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + msg.token,
      },
      body: JSON.stringify({prompt: msg.prompt}),
    })
    .then(r => {
      if (!r.ok) return r.json().then(e => { throw new Error(e.error || 'API 오류 ' + r.status); });
      return r.json();
    })
    .then(data => {
      if (!data.url) throw new Error('이미지 URL 없음');
      stopKeepalive();
      // Cloud Functions는 항상 base64 data URL 반환
      sendResponse({ok: true, data: data.url});
    })
    .catch(e => {
      stopKeepalive();
      console.error('[오블] 이미지 생성 실패:', e.message);
      sendResponse({ok: false, error: e.message});
    });
    return true;
  }

  return false;
});
