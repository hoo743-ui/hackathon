import secrets

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.core.errors import APIError

_bearer = HTTPBearer(auto_error=False)


async def require_ai_token(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str:
    """외부 AI 프로그램 인증. 제어 토큰과 분리해 AI 쪽이 장치를 직접 제어할 권한을 갖지 않게 한다."""
    if not settings.ai_api_token:
        raise APIError(503, "AI_INGEST_DISABLED", "AI_API_TOKEN is not configured")
    if credentials is None:
        raise APIError(401, "UNAUTHORIZED", "Bearer token required")
    if not secrets.compare_digest(credentials.credentials, settings.ai_api_token):
        raise APIError(403, "FORBIDDEN", "Invalid AI token")
    return "ai"
