"""AI 원고 생성 — OpenAI GPT 기반. 전문직 8종 콘텐츠 패턴 + 네이버 SEO 규칙 반영."""
import json
from openai import OpenAI
from app.config import settings

# 블로그 콘텐츠 유형별 글 흐름/표현 톤
JOB_PATTERNS = {
    "정보/설명글": "객관적 정보 전달 중심. 도입에 핵심 답을 먼저 제시하고 근거·상세 설명 전개.",
    "리뷰/후기":   "구매 또는 방문 경험 기반. 장단점 균형 있게 서술, 실제 사용자 시각 강조.",
    "비교/추천":   "2개 이상 대상 비교. 비교표 또는 체크리스트 포함, 최종 추천 의견으로 마무리.",
    "여행/맛집":   "장소 분위기→음식/볼거리→가격·접근성→총평 흐름. 생생한 묘사와 실용 정보 포함.",
    "레시피/요리": "재료 목록→단계별 조리법→완성 팁 순서. 사진 위치 마커를 각 단계에 배치.",
    "제품소개":    "제품 특징→사용 방법→장점 강조→구매 정보. 스펙보다 사용 경험 중심 서술.",
    "일상/에세이": "개인 경험과 감성 서술. 독자 공감을 유도하는 구어체 표현, 자연스러운 흐름.",
    "뉴스/트렌드": "최신 이슈→배경 설명→의미·영향→마무리 의견. 객관적 톤 유지.",
}

SEO_RULES = """[네이버 블로그 작성 규칙 — 반드시 모두 준수]

[글 구조]
- 제목: 25자 이내, 핵심 키워드를 앞쪽에 배치
- 본문: 이미지 사이 각 텍스트 단락은 반드시 400자 이상. 총 4~5개 단락.
  → 단락 하나가 짧으면 절대 안 됨. 400자 미만이면 내용을 더 추가할 것.
- 단락 구분: 각 단락은 빈 줄(\\n\\n)로 반드시 구분. 한 단락 4~6문장.
- 도입부에 핵심 내용 먼저, 1인칭 경험 서술, 구체적 수치/사례 반드시 포함
- AI 티 나는 정형문/과장/금지어 금지

[서식 — 블로그 가독성]
- 소제목은 "■ 소제목" 형식 사용 (마크다운 # 금지)
- 자연스러운 구어체, 읽기 편한 호흡
- 숫자·목록 활용: "첫째~", "① ~" 등 가독성 높이기
- 각 단락 끝에 여운이나 궁금증 유발하는 문장으로 마무리

[이미지 — 정확히 지켜야 함]
- 본문에 정확히 4~5개의 이미지를 삽입 (3개 이하 금지, 6개 이상 금지)
- 텍스트 단락과 단락 사이에만 삽입 (단락 도중 삽입 금지)
- 형식: [이미지: <영어 DALL-E 프롬프트>]
- 프롬프트는 영어, 구체적이고 사진처럼 묘사 (사람, 장소, 색감, 분위기 포함)
- 예) [이미지: A smiling Korean elderly woman preparing colorful vegetables in a bright modern kitchen, natural light, realistic photo style]

[해시태그]
- 정확히 20~25개 제안 (20개 미만 금지)
- 핵심 키워드, 관련어, 독자층 키워드, 계절/지역/상황 키워드 다양하게 포함
"""


def _client():
    """(client, model_name) 튜플 반환 — provider에 따라 분기."""
    from fastapi import HTTPException
    if settings.llm_provider == "gemini":
        key = settings.gemini_api_key
        if not key:
            raise HTTPException(500, "GEMINI_API_KEY가 설정되지 않았습니다. .env에 입력해주세요.")
        client = OpenAI(
            api_key=key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        )
        return client, "gemini-2.5-flash"
    # 기본: OpenAI
    key = settings.openai_api_key
    if not key or not key.isascii() or not key.startswith("sk-"):
        raise HTTPException(500, "OPENAI_API_KEY가 설정되지 않았습니다. .env 파일에 실제 OpenAI API 키를 입력해주세요.")
    return OpenAI(api_key=key), settings.openai_model


def suggest_titles(topic: str, keyword: str, job_type: str,
                   target_audience: str = "60대 성인",
                   current_title: str = "") -> list[str]:
    """5개 제목 후보 반환."""
    hint = f"\n참고 제목(이 방향으로 개선/변형): {current_title}" if current_title else ""
    system = (
        "당신은 네이버 블로그 제목 전문가입니다.\n"
        "[규칙]\n"
        "- 제목은 25자 이내, 핵심 키워드를 앞에 배치\n"
        "- 클릭을 유도하는 구체적 숫자나 혜택 포함\n"
        "- AI 티 나는 과장·정형문 금지\n"
        "- 독자층에 맞는 문체 사용\n"
        "출력은 JSON only: {\"titles\": [\"...\", \"...\", \"...\", \"...\", \"...\"]}"
    )
    user = (
        f"주제: {topic}\n핵심 키워드: {keyword}\n"
        f"글 유형: {job_type}\n독자층: {target_audience}{hint}\n"
        "위 조건에 맞는 네이버 블로그 제목 5개를 추천해주세요."
    )
    client, model = _client()
    title_model = model if settings.llm_provider == "gemini" else "gpt-4o-mini"
    kwargs = dict(
        model=title_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=800,
    )
    # Gemini는 response_format 사용 시 응답이 잘림 → 제거
    if settings.llm_provider != "gemini":
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**kwargs)
    import json as _json
    raw = resp.choices[0].message.content.strip()
    # 마크다운 코드펜스 제거 (```json ... ```)
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        data = _json.loads(raw)
        titles = data.get("titles", [])
        return [str(t) for t in titles[:5]]
    except Exception:
        return [topic[:25]]


def generate_manuscript(topic: str, keyword: str, job_type: str,
                        target_audience: str = "60대 성인",
                        extra: str = "") -> dict:
    """제목/본문/해시태그/이미지마커를 담은 dict 반환."""
    pattern = JOB_PATTERNS.get(job_type, JOB_PATTERNS["정보/설명글"])
    system = (
        "당신은 네이버 블로그 상위노출에 능한 한국어 콘텐츠 작가입니다. "
        f"독자: {target_audience}.\n{SEO_RULES}\n업종 패턴: {pattern}\n"
        "출력은 반드시 JSON만. 키: title, body, hashtags(list), image_markers(int). "
        "마크다운 코드펜스 없이 순수 JSON."
    )
    user = f"주제: {topic}\n핵심 키워드: {keyword}\n추가 지시: {extra or '없음'}"

    client, model = _client()
    kwargs = dict(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=8000,
    )
    if settings.llm_provider != "gemini":
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**kwargs)
    raw = resp.choices[0].message.content.strip()
    # 마크다운 코드펜스 제거
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"title": topic[:25], "body": raw, "hashtags": [keyword], "image_markers": 6}
