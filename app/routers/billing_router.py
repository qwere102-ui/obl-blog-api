from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, Subscription
from app.schemas import SubscribeRequest
from app.auth import get_current_user
from app.plans import get_plan, PLANS
from app.config import settings
from app.services import payments

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/plans")
def list_plans():
    return {name: {"price_krw": p.price_krw, "monthly_manuscripts": p.monthly_manuscripts,
                   "auto_publish": p.auto_publish, "naver_accounts": p.naver_accounts}
            for name, p in PLANS.items()}


@router.post("/subscribe")
def subscribe(req: SubscribeRequest, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    if settings.free_mode:
        return {"status": "free", "message": "현재 전 기능 무료 제공 중 — 결제 불필요"}

    plan = get_plan(req.plan)
    if plan.price_krw <= 0:
        raise HTTPException(400, "유료 플랜만 구독 가능")

    # 첫 결제 즉시 실행
    result = payments.charge_billing_key(
        billing_key=req.billing_key,
        amount=plan.price_krw,
        order_name=f"BlogWriter {plan.name} 월 구독",
        customer={"id": str(user.id), "email": user.email},
    )
    if not result["ok"]:
        raise HTTPException(402, f"결제 실패: {result.get('data')}")

    sub = db.query(Subscription).filter(Subscription.user_id == user.id).first()
    if not sub:
        sub = Subscription(user_id=user.id)
        db.add(sub)
    sub.plan = plan.name
    sub.billing_key = req.billing_key
    sub.status = "active"
    sub.last_payment_id = result["payment_id"]
    sub.next_billing_at = datetime.utcnow() + timedelta(days=30)

    # 유저 플랜 승급 + 쿼터 리셋
    user.plan = plan.name
    user.usage_count = 0
    user.usage_period = datetime.utcnow().strftime("%Y-%m")
    db.commit()
    return {"status": "active", "plan": plan.name, "next_billing_at": sub.next_billing_at}


@router.post("/cancel")
def cancel(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    sub = db.query(Subscription).filter(Subscription.user_id == user.id).first()
    if not sub or sub.status != "active":
        raise HTTPException(404, "활성 구독 없음")
    sub.status = "canceled"   # 다음 청구일에 FREE 강등 (스케줄러가 처리)
    db.commit()
    return {"status": "canceled", "active_until": sub.next_billing_at}


@router.post("/webhook")
async def webhook(request: Request, db: Session = Depends(get_db)):
    """PortOne 결제 결과 웹훅. 예약/재결제 성공·실패 확정 처리.
    운영 시 portone_webhook_secret 으로 서명 검증 추가 필요."""
    payload = await request.json()
    payment_id = payload.get("payment_id") or payload.get("data", {}).get("paymentId", "")
    if not payment_id:
        return {"received": True}

    sub = db.query(Subscription).filter(Subscription.last_payment_id == payment_id).first()
    if not sub:
        return {"received": True}

    plan = get_plan(sub.plan)
    if payments.verify_payment(payment_id, plan.price_krw):
        sub.status = "active"
        sub.next_billing_at = datetime.utcnow() + timedelta(days=30)
        u = db.query(User).filter(User.id == sub.user_id).first()
        if u:
            u.usage_count = 0
            u.usage_period = datetime.utcnow().strftime("%Y-%m")
    else:
        sub.status = "past_due"
    db.commit()
    return {"received": True, "status": sub.status}
