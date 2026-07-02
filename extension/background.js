// 아이콘 클릭 시 Side Panel 열기
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true});
});

const BACKEND = 'https://obl-blog-api.onrender.com';

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

    fetch(`${BACKEND}/manuscripts/generate-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + msg.token,
      },
      body: JSON.stringify({prompt: msg.prompt}),
    })
    .then(r => {
      if (!r.ok) return r.json().then(e => { throw new Error(e.detail || 'API 오류 ' + r.status); });
      return r.json();
    })
    .then(data => {
      if (!data.url) throw new Error('이미지 URL 없음');
      console.log('[오블] 이미지 획득:', data.url.slice(0, 60));

      if (data.url.startsWith('data:')) {
        stopKeepalive();
        sendResponse({ok: true, data: data.url});
        return;
      }

      // 외부 URL → fetch → base64
      fetch(data.url)
        .then(r => { if (!r.ok) throw new Error('이미지 다운로드 실패 ' + r.status); return r.blob(); })
        .then(blob => {
          if (blob.size === 0) throw new Error('이미지 데이터 비어있음');
          const reader = new FileReader();
          reader.onload  = () => { stopKeepalive(); sendResponse({ok: true,  data: reader.result}); };
          reader.onerror = () => { stopKeepalive(); sendResponse({ok: false, error: 'FileReader 오류'}); };
          reader.readAsDataURL(blob);
        })
        .catch(e => { stopKeepalive(); sendResponse({ok: false, error: e.message}); });
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
