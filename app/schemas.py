from pydantic import BaseModel, EmailStr
from typing import Optional


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    plan: str = "FREE"


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class GenerateRequest(BaseModel):
    topic: str
    keyword: str
    job_type: str = "정보글"   # 의사/변호사/세무사/공인중개사/약사/한의사/수의사/회계사 등
    target_audience: Optional[str] = "60대 성인"
    extra_instructions: Optional[str] = ""
    generate_image: bool = False


class ManuscriptOut(BaseModel):
    id: int
    title: str
    body: str
    job_type: str
    thumbnail_url: str
    review_json: str
    status: str

    class Config:
        from_attributes = True


class NaverSessionRequest(BaseModel):
    naver_id: str
    naver_pw: str           # 세션 저장 1회용 — DB 저장 안 함

class PublishRequest(BaseModel):
    manuscript_id: int
    naver_id: str           # 저장된 세션 사용
    tags: list[str] = []
    confirm: bool = False


class SubscribeRequest(BaseModel):
    plan: str            # BASIC|PRO|BUSINESS
    billing_key: str     # 프론트 SDK requestIssueBillingKey 결과
