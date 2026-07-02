import os
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from app.database import Base, engine
from app.routers import auth_router, manuscript_router, publish_router, billing_router

Base.metadata.create_all(bind=engine)

app = FastAPI(title="BlogWriter API", version="0.1.0",
              description="AI 네이버 블로그 원고 SaaS — 생성/검토/이미지/발행")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(manuscript_router.router)
app.include_router(publish_router.router)
app.include_router(billing_router.router)

_HTML = os.path.join(os.path.dirname(__file__), "static", "index.html")


@app.get("/", response_class=HTMLResponse)
def root():
    with open(_HTML, encoding="utf-8") as f:
        return f.read()
