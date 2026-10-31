"""적재율 계산. 시스템 전체에서 적재율은 이 모듈에서만 계산한다."""


def compute_fill_percent(
    distance_cm: float | None,
    empty_distance_cm: float | None,
    full_distance_cm: float | None,
) -> float | None:
    """거리 → 적재율(0~100). 거리가 없거나 미보정이면 None (0%와 구분)."""
    if distance_cm is None or empty_distance_cm is None or full_distance_cm is None:
        return None
    span = empty_distance_cm - full_distance_cm
    if span <= 0:
        raise ValueError("empty_distance_cm must be greater than full_distance_cm")
    percent = (empty_distance_cm - distance_cm) / span * 100
    return round(min(100.0, max(0.0, percent)), 1)


def is_full(fill_percent: float | None, threshold: float) -> bool:
    return fill_percent is not None and fill_percent >= threshold
