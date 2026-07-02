"""플랜 정의 + 월간 쿼터. SaaS 과금/제한의 단일 진실 소스."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Plan:
    name: str
    monthly_manuscripts: int      # -1 = 무제한
    image_generation: bool
    auto_review: bool
    auto_publish: bool
    naver_accounts: int           # 연결 가능한 네이버 계정 수
    price_krw: int                # 월 구독료(원)


PLANS = {
    "FREE":     Plan("FREE",     monthly_manuscripts=3,   image_generation=False, auto_review=True,  auto_publish=False, naver_accounts=0,  price_krw=0),
    "BASIC":    Plan("BASIC",    monthly_manuscripts=50,  image_generation=True,  auto_review=True,  auto_publish=False, naver_accounts=1,  price_krw=9900),
    "PRO":      Plan("PRO",      monthly_manuscripts=300, image_generation=True,  auto_review=True,  auto_publish=True,  naver_accounts=3,  price_krw=29000),
    "BUSINESS": Plan("BUSINESS", monthly_manuscripts=-1,  image_generation=True,  auto_review=True,  auto_publish=True,  naver_accounts=20, price_krw=79000),
}


def get_plan(name: str) -> Plan:
    return PLANS.get(name, PLANS["FREE"])


def effective_plan(name: str) -> Plan:
    """FREE_MODE가 켜져 있으면 플랜과 무관하게 전 기능 무제한 개방."""
    from app.config import settings
    if settings.free_mode:
        return PLANS["BUSINESS"]
    return get_plan(name)
