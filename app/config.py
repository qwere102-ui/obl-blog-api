from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_secret: str = "dev-secret"
    database_url: str = "sqlite:///./blogwriter.db"
    openai_model: str = "gpt-4o"
    image_provider: str = "dummy"
    # LLM 공급자: openai | gemini
    llm_provider: str = "openai"
    gemini_api_key: str = ""
    portone_api_secret: str = ""
    portone_webhook_secret: str = ""
    # True면 결제/쿼터 무시하고 전 기능 무료 개방. 유료 전환 시 False
    free_mode: bool = True
    openai_api_key: str = ""
    # 네이버 발행 전 사람이 최종 확인하도록 강제 (안전장치)
    manual_confirm: bool = True
    access_token_expire_minutes: int = 60 * 24

    class Config:
        env_file = ".env"


settings = Settings()
