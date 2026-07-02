"""네이버 블로그 발행 — Playwright + SmartEditor ONE.
핵심 보강:
  1) storage_state(쿠키) 저장/재사용 → 매번 로그인·2FA 회피
  2) SmartEditor ONE 은 mainFrame > 에디터 iframe 2중 구조 — 실제 셀렉터 반영
  3) [이미지] 마커를 실제 이미지 업로드 위치로 매핑
주의: 네이버 UI 변경 시 셀렉터 보수 필요. 캡차/2FA 는 headless=False 에서 사람이 처리.
"""
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

SESSION_DIR = Path("./sessions")
SESSION_DIR.mkdir(exist_ok=True)


def _session_path(naver_id: str) -> Path:
    return SESSION_DIR / f"{naver_id}.json"


def login_and_save_session(naver_id: str, naver_pw: str, wait_for_2fa: int = 30) -> dict:
    """최초 1회 로그인 후 세션 저장. 2FA/캡차는 열린 창에서 사람이 처리."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context()
        page = ctx.new_page()
        try:
            page.goto("https://nid.naver.com/nidlogin.login")
            # 네이버는 자동입력 방지 → JS로 직접 값 주입이 더 안정적
            page.evaluate(
                """([id, pw]) => {
                    document.querySelector('#id').value = id;
                    document.querySelector('#pw').value = pw;
                }""",
                [naver_id, naver_pw],
            )
            page.click("button[type=submit]")
            # 2FA/기기등록/캡차 처리 대기
            deadline = time.time() + wait_for_2fa
            while "nidlogin" in page.url and time.time() < deadline:
                page.wait_for_timeout(1000)
            if "nidlogin" in page.url:
                return {"ok": False, "error": "로그인 미완료(2FA/캡차 시간초과)"}
            ctx.storage_state(path=str(_session_path(naver_id)))
            return {"ok": True, "session": str(_session_path(naver_id))}
        finally:
            browser.close()


def publish_to_naver(naver_id: str, title: str, body: str,
                     tags: list[str] | None = None,
                     image_paths: list[str] | None = None,
                     headless: bool = True) -> dict:
    """저장된 세션으로 발행. 세션 없으면 먼저 login_and_save_session 호출 필요."""
    session = _session_path(naver_id)
    if not session.exists():
        return {"ok": False, "error": "세션 없음 — login_and_save_session 먼저 실행"}

    tags = tags or []
    image_paths = image_paths or []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        ctx = browser.new_context(storage_state=str(session))
        page = ctx.new_page()
        try:
            # 글쓰기 진입 (PostWriteForm)
            page.goto(f"https://blog.naver.com/{naver_id}/postwrite", wait_until="networkidle")
            page.wait_for_timeout(2000)

            # SmartEditor ONE 은 mainFrame iframe 안에 있음
            editor = page.frame_locator("iframe#mainFrame")

            # 이전 작성글 이어쓰기 팝업 닫기 (있을 때만)
            try:
                editor.locator("button.se-popup-button-cancel").click(timeout=2000)
            except PWTimeout:
                pass

            # 제목 입력 (se-title-text 영역의 contenteditable span)
            title_box = editor.locator(".se-section-documentTitle .se-text-paragraph")
            title_box.click()
            page.keyboard.type(title, delay=10)

            # 본문 입력 — [이미지] 마커 기준으로 분할해 텍스트/이미지 교차 삽입
            body_box = editor.locator(".se-section-text .se-text-paragraph").first
            body_box.click()
            img_idx = 0
            for chunk in body.split("[이미지]"):
                if chunk.strip():
                    page.keyboard.type(chunk.strip(), delay=5)
                    page.keyboard.press("Enter")
                if img_idx < len(image_paths) and os.path.exists(image_paths[img_idx]):
                    # 사진 업로드: 툴바 사진버튼 → file input
                    editor.locator("button.se-image-toolbar-button").click()
                    page.set_input_files("input[type=file]", image_paths[img_idx])
                    page.wait_for_timeout(1500)
                    img_idx += 1

            # 발행 버튼 → 발행 설정 패널
            editor.locator("button.publish_btn__m9KHH, button:has-text('발행')").first.click()
            page.wait_for_timeout(1000)

            # 태그 입력
            if tags:
                tag_input = editor.locator("input#tag-input, .tag_input__rvUB5 input").first
                for t in tags[:30]:
                    tag_input.fill(t)
                    page.keyboard.press("Enter")

            # 최종 발행 확정
            editor.locator("button:has-text('발행'), button.confirm_btn__WEaBq").last.click()
            page.wait_for_timeout(3000)

            return {"ok": True, "url": f"https://blog.naver.com/{naver_id}"}
        except Exception as e:
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}
        finally:
            browser.close()
