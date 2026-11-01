"""2차 판정 규칙 (모델 없이 판정 로직만)."""
from smartrecycle_edge.verifier import Verdict, decide

KW = dict(bg_reject=0.6, override_prob=0.7, keep_conf=0.85)


def v(top, prob, bg=0.1):
    return Verdict(top, prob, {top: prob}, bg)


def test_background_rejected_even_with_confident_yolo():
    # 리허설 실측: 사람 얼굴을 Metal 0.83 으로 인식 → 무시해야 함
    assert decide("Metal", 0.83, v("metal", 0.9, bg=0.99), **KW)[0] is None


def test_agreement_keeps_class():
    assert decide("Plastic", 0.7, v("plastic", 0.8), **KW)[0] == "plastic"


def test_confident_verifier_corrects_uncertain_yolo():
    assert decide("Plastic", 0.66, v("glass", 0.9), **KW)[0] == "glass"


def test_confident_yolo_is_kept():
    assert decide("Plastic", 0.9, v("glass", 0.95), **KW)[0] == "plastic"


def test_weak_verifier_does_not_override():
    assert decide("Metal", 0.7, v("paper", 0.5), **KW)[0] == "metal"


def test_other_never_becomes_a_bin():
    assert decide("Paper", 0.7, v("other", 0.95), **KW)[0] == "paper"
