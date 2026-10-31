import secrets

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.core.errors import APIError

_bearer = HTTPBearer(auto_error=False)


async def require_control_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """제어/보정 API 권한 검증. 반환값은 감사 로그용 요청자 식별자."""
    if credentials is None:
        raise APIError(401, "UNAUTHORIZED", "Bearer token required")
    if not secrets.compare_digest(credentials.credentials, settings.api_control_token):
        raise APIError(403, "FORBIDDEN", "Invalid control token")
    return "api-token"
