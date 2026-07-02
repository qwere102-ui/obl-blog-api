"""규칙 검사 + 자동수정. 네이버 SEO 규칙을 코드로 강제 (블덱스라이터의 'AI 검토/자동수정' 대응)."""
import re

# 필요시 운영하면서 확장. 과장/의료단정 등 위험 표현 예시.
BANNED_WORDS = ["100% 보장", "무조건", "완치", "부작용 없음", "최고의", "절대"]

TITLE_MAX = 25
BODY_MIN = 1500
IMG_MIN, IMG_MAX = 6, 13
TAG_MIN, TAG_MAX = 3, 30


def review(title: str, body: str, hashtags: list, image_markers: int) -> dict:
    issues = []
    fixes = []

    # 제목 길이
    if len(title) > TITLE_MAX:
        issues.append(f"제목 {len(title)}자 (최대 {TITLE_MAX}자 초과)")
        title = title[:TITLE_MAX]
        fixes.append("제목 25자로 절삭")

    # 본문 글자수(공백 제외)
    char_count = len(re.sub(r"\s", "", body))
    if char_count < BODY_MIN:
        issues.append(f"본문 {char_count}자 (최소 {BODY_MIN}자 미달)")

    # 금지어
    found = [w for w in BANNED_WORDS if w in title or w in body]
    if found:
        issues.append(f"금지/위험 표현: {', '.join(found)}")

    # 이미지 마커
    marker_count = body.count("[이미지]") or image_markers
    if marker_count < IMG_MIN:
        issues.append(f"이미지 위치 {marker_count}개 (권장 {IMG_MIN}~{IMG_MAX})")

    # 해시태그
    if not (TAG_MIN <= len(hashtags) <= TAG_MAX):
        issues.append(f"해시태그 {len(hashtags)}개 (권장 {TAG_MIN}~{TAG_MAX})")
        hashtags = hashtags[:TAG_MAX]
        fixes.append("해시태그 30개로 제한")

    return {
        "passed": len(issues) == 0,
        "char_count": char_count,
        "issues": issues,
        "auto_fixes": fixes,
        "title": title,
        "hashtags": hashtags,
    }
