# BlogWriter — AI 네이버 블로그 원고 SaaS (스캐폴드 v0.2)

블덱스라이터 스타일 풀 파이프라인 + 멀티유저(SaaS) + PortOne 정기결제.
**원고 생성 → 자동 검토/수정 → 썸네일 → 네이버 발행** + 플랜별 쿼터 + 빌링키 구독.

## API 엔드포인트
```
POST /auth/signup            회원가입 (→ JWT)
POST /auth/login             로그인 (→ JWT)
POST /manuscripts/generate   AI 원고 생성 + 검토 (+이미지)
GET  /manuscripts/           내 원고 목록
GET  /billing/plans          플랜/가격 조회
POST /billing/subscribe      빌링키로 구독 시작(첫 결제 즉시)
POST /billing/cancel         구독 해지(다음 청구일 강등)
POST /billing/webhook        PortOne 결제결과 수신
POST /publish/session        네이버 세션 1회 저장(2FA 직접 처리)
POST /publish/               원고 네이버 발행(세션 재사용)
```

## 플랜
| 플랜 | 월요금 | 원고/월 | 이미지 | 자동발행 | 네이버계정 |
|---|---|---|---|---|---|
| FREE | 0 | 3 | ✕ | ✕ | 0 |
| BASIC | 9,900 | 50 | ○ | ✕ | 1 |
| PRO | 29,000 | 300 | ○ | ○ | 3 |
| BUSINESS | 79,000 | 무제한 | ○ | ○ | 20 |

## 빠른 시작
```bash
python -m venv venv && venv\Scripts\activate   # Windows
pip install -r requirements.txt
playwright install chromium
copy .env.example .env       # 키 채우기
uvicorn app.main:app --reload
```
→ http://127.0.0.1:8000/docs

## 무료 모드 (현재 기본값)
`.env` 의 `FREE_MODE=True` (기본) 이면 플랜·결제·쿼터를 모두 무시하고 **전 기능을 무료 개방**합니다.
- 모든 가입자가 원고 무제한 + 이미지 + 자동발행 사용
- `/billing/subscribe` 는 과금 없이 "무료 제공 중" 응답
- 유료 전환: `FREE_MODE=False` 로 바꾸면 기존 플랜/빌링키 로직이 그대로 작동 (코드 보존됨)

## 결제 흐름 (PortOne V2)
1. 프론트에서 `@portone/browser-sdk/v2` 의 `requestIssueBillingKey()` 로 빌링키 발급
2. 발급된 `billingKey` 를 `POST /billing/subscribe` 로 전달 → 첫 결제 + 플랜 활성화
3. 매월 갱신은 `services/payments.charge_billing_key()` (스케줄러/크론으로 호출)
4. 결과는 `POST /billing/webhook` 으로 비동기 확정 (금액·상태 재검증)
   - 인증: `Authorization: PortOne {API_SECRET}` / base `https://api.portone.io`

## 네이버 발행 흐름
1. `POST /publish/session` 1회 — 창 열려서 2FA/캡차 직접 처리 → `sessions/{id}.json` 저장
2. 이후 `POST /publish/` 는 저장 세션으로 비번 없이 발행 (`MANUAL_CONFIRM` 기본 ON)

## 개발 로드맵
- [x] 인증/플랜/원고생성/검토
- [x] 네이버 발행 (세션 저장 + SmartEditor ONE 셀렉터)
- [x] PortOne 정기결제 (구독/해지/웹훅)
- [ ] 이미지 provider 실연결 (OpenAI/Stability/Nano Banana)
- [ ] 월 갱신 스케줄러 (Celery/RQ + cron) — charge_billing_key 자동 호출
- [ ] 웹훅 서명 검증 (portone_webhook_secret)
- [ ] SmartEditor 셀렉터 실DOM 최종 검증 (네이버 UI 수시 변경)
- [ ] 관리자 대시보드 + 블덱스식 지수/키워드 연동

## 주의
- 네이버 자동발행은 약관·저품질 리스크 → `MANUAL_CONFIRM=True` 유지 권장
- 빌링키/세션 파일은 민감정보 — 운영 시 암호화 저장 및 .gitignore 필수
