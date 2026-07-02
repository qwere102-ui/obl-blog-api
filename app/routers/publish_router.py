import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, Manuscript, PublishJob
from app.schemas import PublishRequest, NaverSessionRequest
from app.auth import get_current_user
from app.plans import effective_plan
from app.config import settings
from app.services import naver_publisher

router = APIRouter(prefix="/publish", tags=["publish"])


@router.post("/session")
def save_session(req: NaverSessionRequest, user: User = Depends(get_current_user)):
    """네이버 세션 최초 1회 저장(2FA 직접 처리). 이후 발행은 비번 없이 진행."""
    if not effective_plan(user.plan).auto_publish:
        raise HTTPException(403, "PRO 이상에서 자동 발행 사용 가능")
    return naver_publisher.login_and_save_session(req.naver_id, req.naver_pw)


@router.post("/")
def publish(req: PublishRequest, db: Session = Depends(get_db),
            user: User = Depends(get_current_user)):
    if not effective_plan(user.plan).auto_publish:
        raise HTTPException(403, f"{user.plan} 플랜은 자동 발행 미지원 (PRO 이상)")

    m = db.query(Manuscript).filter(
        Manuscript.id == req.manuscript_id, Manuscript.owner_id == user.id
    ).first()
    if not m:
        raise HTTPException(404, "원고 없음")

    # 안전장치: 최종 확인 강제
    if settings.manual_confirm and not req.confirm:
        job = PublishJob(manuscript_id=m.id, status="awaiting_confirm",
                         detail="confirm=true 로 재요청 시 발행")
        db.add(job); db.commit(); db.refresh(job)
        return {"status": "awaiting_confirm", "job_id": job.id,
                "message": "최종 확인 필요 — confirm=true 로 다시 호출하세요"}

    job = PublishJob(manuscript_id=m.id, status="pending")
    db.add(job); db.commit(); db.refresh(job)

    result = naver_publisher.publish_to_naver(
        naver_id=req.naver_id, title=m.title, body=m.body, tags=req.tags,
    )
    if result.get("ok"):
        job.status = "done"; job.confirmed = True; m.status = "published"
    else:
        job.status = "failed"; job.detail = result.get("error", "")
    db.commit()
    return {"status": job.status, "result": result}
