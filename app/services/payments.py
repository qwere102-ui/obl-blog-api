"""PortOne V2 빌링키 정기결제 클라이언트.
플로우:
  1) 프론트 SDK requestIssueBillingKey() → billingKey 발급 → 백엔드 전달
  2) 백엔드가 billingKey 를 유저와 매핑 저장 (Subscription)
  3) 매월 charge_billing_key() 로 결제 → 성공 시 플랜/쿼터 갱신
  4) 웹훅으로 결과 비동기 확정 (verify_payment)
인증: Authorization: PortOne {API_SECRET}
"""
import uuid
import httpx
from app.config import settings

BASE = "https://api.portone.io"


def _headers() -> dict:
    return {
        "Authorization": f"PortOne {settings.portone_api_secret}",
        "Content-Type": "application/json",
    }


def charge_billing_key(billing_key: str, amount: int, order_name: str,
                       customer: dict, payment_id: str | None = None) -> dict:
    """빌링키로 즉시 결제. payment_id 는 고객사에서 채번(중복 방지)."""
    payment_id = payment_id or f"pay-{uuid.uuid4().hex[:24]}"
    url = f"{BASE}/payments/{payment_id}/billing-key"
    body = {
        "billingKey": billing_key,
        "orderName": order_name,
        "amount": {"total": amount},
        "currency": "KRW",
        "customer": customer,
    }
    headers = {**_headers(), "Idempotency-Key": payment_id}
    with httpx.Client(timeout=20) as c:
        r = c.post(url, json=body, headers=headers)
    ok = r.status_code == 200
    return {"ok": ok, "payment_id": payment_id, "status_code": r.status_code,
            "data": r.json() if r.content else {}}


def get_payment(payment_id: str) -> dict:
    """결제 단건 조회 — 웹훅 수신 후 검증용."""
    with httpx.Client(timeout=20) as c:
        r = c.get(f"{BASE}/payments/{payment_id}", headers=_headers())
    return r.json() if r.content else {}


def verify_payment(payment_id: str, expected_amount: int) -> bool:
    """웹훅 도착 시 실제 결제 상태/금액을 PortOne 서버에서 재검증."""
    data = get_payment(payment_id)
    status = data.get("status")
    paid = data.get("amount", {}).get("total")
    return status == "PAID" and paid == expected_amount
