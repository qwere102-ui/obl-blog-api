"""이미지 생성 서비스.

IMAGE_PROVIDER 환경변수:
  gemini      — Gemini 2.0 Flash (무료, 기본)
  dalle       — gpt-image-2 low ($0.02/장)
  pollinations — Pollinations AI (무료, 저품질)
"""
import base64
import urllib.parse
from app.config import settings


def generate_thumbnail(title: str, keyword: str) -> str:
    return generate_from_prompt(
        f"Blog thumbnail for Korean blog post about '{keyword}', "
        "clean modern photo style, no text overlay"
    )


def generate_from_prompt(prompt: str) -> str:
    provider = settings.image_provider
    if provider == "dalle":
        return _gpt_image(prompt)
    if provider == "pollinations":
        return _pollinations(prompt)
    # 기본: gemini
    return _gemini_image(prompt)


# ── Gemini 2.0 Flash 이미지 생성 (무료) ──────────────────────
def _gemini_image(prompt: str) -> str:
    from fastapi import HTTPException
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise HTTPException(500, "google-genai 패키지가 없습니다. pip install google-genai")

    key = settings.gemini_api_key
    if not key:
        raise HTTPException(500, "GEMINI_API_KEY가 설정되지 않았습니다.")

    try:
        client = genai.Client(api_key=key)
        response = client.models.generate_content(
            model="gemini-2.5-flash-image",
            contents=prompt[:1000],
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
            ),
        )
        for part in response.candidates[0].content.parts:
            if part.inline_data and part.inline_data.data:
                b64 = base64.b64encode(part.inline_data.data).decode()
                mime = part.inline_data.mime_type or "image/png"
                return f"data:{mime};base64,{b64}"
        raise HTTPException(500, "Gemini 이미지 데이터 없음")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Gemini 이미지 생성 오류: {str(e)[:300]}")


# ── gpt-image-2 low ($0.02/장) ───────────────────────────────
def _gpt_image(prompt: str) -> str:
    from openai import OpenAI
    from fastapi import HTTPException

    key = settings.openai_api_key
    if not key or not key.startswith("sk-"):
        raise HTTPException(500, "OPENAI_API_KEY가 설정되지 않았습니다.")

    client = OpenAI(api_key=key)
    try:
        resp = client.images.generate(
            model="gpt-image-2",
            prompt=prompt[:1000],
            n=1, size="1024x1024", quality="low",
        )
        b64 = resp.data[0].b64_json
        if not b64:
            raise HTTPException(500, "이미지 데이터 비어있음")
        return f"data:image/png;base64,{b64}"
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"gpt-image-2 오류: {str(e)[:200]}")


# ── Pollinations (무료, 저품질) ──────────────────────────────
def _pollinations(prompt: str) -> str:
    encoded = urllib.parse.quote(prompt[:500])
    seed = abs(hash(prompt)) % 99999
    return (
        f"https://image.pollinations.ai/prompt/{encoded}"
        f"?model=flux-realism&width=1024&height=1024&nologo=true&seed={seed}"
    )
