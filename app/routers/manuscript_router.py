import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, Manuscript
from app.schemas import GenerateRequest, ManuscriptOut
from app.auth import get_current_user
from app.plans import effective_plan
from app.services import writer, reviewer, imagegen

router = APIRouter(prefix="/manuscripts", tags=["manuscripts"])


def _check_quota(user: User, db: Session):
    period = datetime.utcnow().strftime("%Y-%m")
    if user.usage_period != period:
        user.usage_period = period
        user.usage_count = 0
    limit = effective_plan(user.plan).monthly_manuscripts
    if limit != -1 and user.usage_count >= limit:
        raise HTTPException(402, f"{user.plan} 플랜 월 한도({limit}) 초과")


@router.post("/generate")
def generate(req: GenerateRequest, db: Session = Depends(get_db),
             user: User = Depends(get_current_user)):
    plan = effective_plan(user.plan)
    _check_quota(user, db)

    draft = writer.generate_manuscript(
        req.topic, req.keyword, req.job_type, req.target_audience, req.extra_instructions or ""
    )
    hashtags = draft.get("hashtags", [])
    rev = reviewer.review(
        draft.get("title", ""), draft.get("body", ""),
        hashtags, draft.get("image_markers", 4),
    ) if plan.auto_review else {}

    thumb = ""
    if req.generate_image and plan.image_generation:
        thumb = imagegen.generate_thumbnail(draft.get("title", ""), req.keyword)

    m = Manuscript(
        owner_id=user.id, topic=req.topic, keyword=req.keyword, job_type=req.job_type,
        title=rev.get("title", draft.get("title", "")), body=draft.get("body", ""),
        thumbnail_url=thumb, review_json=json.dumps(rev, ensure_ascii=False),
        status="reviewed" if rev else "draft",
    )
    db.add(m)
    user.usage_count += 1
    db.commit(); db.refresh(m)
    # hashtags는 DB에 없으므로 draft에서 직접 포함해서 반환
    return {
        "id": m.id, "title": m.title, "body": m.body, "job_type": m.job_type,
        "thumbnail_url": m.thumbnail_url, "review_json": m.review_json, "status": m.status,
        "hashtags": hashtags,
    }


@router.get("/", response_model=list[ManuscriptOut])
def my_manuscripts(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(Manuscript).filter(Manuscript.owner_id == user.id).all()


from pydantic import BaseModel as PydanticBase

class SuggestTitlesRequest(PydanticBase):
    topic: str
    keyword: str
    job_type: str = "정보/설명글"
    target_audience: str = "60대 성인"
    current_title: str = ""

@router.post("/suggest-titles")
def suggest_titles(req: SuggestTitlesRequest, user: User = Depends(get_current_user)):
    from app.services.writer import suggest_titles as _suggest
    titles = _suggest(req.topic, req.keyword, req.job_type, req.target_audience, req.current_title)
    return {"titles": titles}

class ImagePromptRequest(PydanticBase):
    prompt: str

@router.post("/generate-image")
def gen_inline_image(req: ImagePromptRequest, user: User = Depends(get_current_user)):
    from app.services.imagegen import generate_from_prompt
    url = generate_from_prompt(req.prompt)
    return {"url": url}
