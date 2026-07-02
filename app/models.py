from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    plan = Column(String, default="FREE")
    usage_count = Column(Integer, default=0)        # 이번 달 생성 수
    usage_period = Column(String, default="")       # "YYYY-MM"
    created_at = Column(DateTime, default=datetime.utcnow)
    manuscripts = relationship("Manuscript", back_populates="owner")


class Manuscript(Base):
    __tablename__ = "manuscripts"
    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"))
    topic = Column(String)
    keyword = Column(String)
    job_type = Column(String)        # 전문직 8종 등
    title = Column(String)
    body = Column(Text)
    thumbnail_url = Column(String, default="")
    review_json = Column(Text, default="")  # 검토 결과(JSON 직렬화)
    status = Column(String, default="draft")  # draft|reviewed|published
    created_at = Column(DateTime, default=datetime.utcnow)
    owner = relationship("User", back_populates="manuscripts")


class PublishJob(Base):
    __tablename__ = "publish_jobs"
    id = Column(Integer, primary_key=True, index=True)
    manuscript_id = Column(Integer, ForeignKey("manuscripts.id"))
    status = Column(String, default="pending")  # pending|awaiting_confirm|done|failed
    detail = Column(Text, default="")
    confirmed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Subscription(Base):
    __tablename__ = "subscriptions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    plan = Column(String, default="FREE")
    billing_key = Column(String, default="")     # PortOne 빌링키
    status = Column(String, default="inactive")  # inactive|active|past_due|canceled
    last_payment_id = Column(String, default="")
    next_billing_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
