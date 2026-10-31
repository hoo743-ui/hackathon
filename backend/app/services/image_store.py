"""분류 이미지 파일 저장. DB에는 UPLOAD_DIR 기준 상대 경로만 기록한다."""
import os
import tempfile
from pathlib import Path
from uuid import UUID

from app.core.config import settings
from app.core.errors import APIError

BACKEND_DIR = Path(__file__).resolve().parents[2]
ALLOWED = {"image/jpeg": ".jpg", "image/png": ".png"}


def upload_root() -> Path:
    root = Path(settings.upload_dir)
    if not root.is_absolute():
        root = BACKEND_DIR / root
    root.mkdir(parents=True, exist_ok=True)
    return root


def _sniff(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    return None


def validate(data: bytes, declared_type: str | None) -> str:
    """크기·MIME·실제 파일 서명을 검사하고 확장자를 반환한다."""
    if not data:
        raise APIError(422, "IMAGE_EMPTY", "image file is empty")
    if len(data) > settings.max_image_bytes:
        raise APIError(413, "IMAGE_TOO_LARGE", f"image exceeds {settings.max_image_bytes} bytes")
    actual = _sniff(data)
    if actual is None:
        raise APIError(415, "IMAGE_TYPE_UNSUPPORTED", "only JPEG or PNG images are accepted")
    if declared_type and declared_type.split(";")[0].strip() not in ALLOWED:
        raise APIError(415, "IMAGE_TYPE_UNSUPPORTED", f"content-type {declared_type} not allowed")
    return ALLOWED[actual]


def save(detection_id: UUID, data: bytes, ext: str, day: str) -> str:
    """원자적 저장 (임시 파일 → rename). 반환: 상대 경로."""
    rel = Path(day) / f"{detection_id}{ext}"
    dest = upload_root() / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=dest.parent, suffix=".part")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, dest)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return rel.as_posix()


def resolve(rel: str) -> Path:
    root = upload_root().resolve()
    path = (root / rel).resolve()
    if root not in path.parents:
        raise APIError(404, "IMAGE_NOT_FOUND", "image not found")
    return path


def discard(rel: str) -> None:
    try:
        resolve(rel).unlink(missing_ok=True)
    except APIError:
        pass
