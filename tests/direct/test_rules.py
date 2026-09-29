import copy

import pytest

from .source_helpers import _normalize_compilation_shape, _normalize_game_result, _valid_compilation


GOOD_RULES = {
    "platform": "LICHESS",
    "variant": "STANDARD",
    "rated": "REQUIRED",
    "speed": "BLITZ",
    "player_color": "BLACK",
    "result": "WIN",
    "max_plies": 80,
}


def game_record(**overrides):
    game = {
        "fetch_status": "OK",
        "id": "AbCd1234",
        "rated": True,
        "variant": "standard",
        "speed": "blitz",
        "status": "mate",
        "source": "api",
        "winner": "black",
        "created_at_ms": 1_790_592_000_000,
        "last_move_at_ms": 1_790_592_050_000,
        "white_id": "opponent",
        "black_id": "clutchplayer",
        "white_bot": False,
        "black_bot": False,
        "plies": 80,
        "initial_fen": None,
    }
    game.update(overrides)
    return game


def quest_record(**overrides):
    quest = {
        "rules": copy.deepcopy(GOOD_RULES),
        "activated_at_ms": 1_790_591_000_000,
        "starts_at_ms": 1_790_591_000_000,
        "ends_at_ms": 1_790_600_000_000,
    }
    quest.update(overrides)
    return quest


def enrollment_record(**overrides):
    enrollment = {"lichess_id": "clutchplayer", "enrolled_at_ms": 1_790_591_500_000}
    enrollment.update(overrides)
    return enrollment


def valid_compilation(rules=None):
    return {
        "status": "COMPILED",
        "rules": copy.deepcopy(rules or GOOD_RULES),
        "reason_codes": [],
    }


@pytest.mark.parametrize("field,value", [
    ("platform", "CHESSCOM"),
    ("variant", "CHESS960"),
    ("rated", "MAYBE"),
    ("speed", "SUPERFAST"),
    ("player_color", "GREEN"),
    ("result", "MAYBE"),
])
def test_compilation_rejects_unknown_rule_enum(field, value):
    compiled = valid_compilation()
    compiled["rules"][field] = value
    assert not _valid_compilation(compiled)


def test_compilation_rejects_silent_keys_and_bad_move_bounds():
    extra = valid_compilation()
    extra["rules"]["opponent_rating"] = 2000
    assert not _valid_compilation(extra)
    for value in (0, -1, 401, True, "80"):
        bounded = valid_compilation()
        bounded["rules"]["max_plies"] = value
        assert not _valid_compilation(bounded)


def test_noncompiled_output_requires_null_rules_and_bounded_reason_codes():
    good = {"status": "NEEDS_CLARIFICATION", "rules": None, "reason_codes": ["MISSING_RESULT"]}
    assert _valid_compilation(good)
    assert not _valid_compilation({**good, "rules": GOOD_RULES})
    assert not _valid_compilation({**good, "reason_codes": ["MISSING_RESULT", "NOPE"]})
    assert not _valid_compilation({**good, "reason_codes": ["MISSING_RESULT"] * 4})


def test_noncompiled_model_may_omit_only_the_null_rules_field():
    model_output = {"status": "UNSUPPORTED", "reason_codes": ["UNSUPPORTED_MULTIGAME"]}
    normalized = _normalize_compilation_shape(model_output)
    assert normalized == {**model_output, "rules": None}
    assert _valid_compilation(normalized)
    assert not _valid_compilation(_normalize_compilation_shape({"status": "COMPILED", "reason_codes": []}))
    assert not _valid_compilation(_normalize_compilation_shape({**model_output, "rules": GOOD_RULES, "extra": True}))


def test_complete_winning_game_passes_boundary_and_half_move_limit():
    result = _normalize_game_result(quest_record(), enrollment_record(), game_record(), "AbCd1234")
    assert result["outcome"] == "VERIFIED"
    assert all(check["status"] == "PASS" for check in result["checks"])


@pytest.mark.parametrize("overrides,expected_reason", [
    ({"id": "Other123"}, "WRONG_GAME_ID"),
    ({"rated": False}, "RATED_MISMATCH"),
    ({"speed": "rapid"}, "SPEED_MISMATCH"),
    ({"white_id": "clutchplayer", "black_id": "opponent", "winner": "black"}, "COLOR_MISMATCH"),
    ({"winner": "white"}, "RESULT_MISMATCH"),
    ({"plies": 82}, "MAX_PLIES_EXCEEDED"),
    ({"source": "import"}, "GAME_SOURCE_DISALLOWED"),
    ({"black_bot": True}, "BOT_GAME_DISALLOWED"),
])
def test_sufficient_but_nonqualifying_game_is_not_qualified(overrides, expected_reason):
    result = _normalize_game_result(quest_record(), enrollment_record(), game_record(**overrides), "AbCd1234")
    assert result["outcome"] == "NOT_QUALIFIED"
    assert expected_reason in result["reason_codes"]


@pytest.mark.parametrize("field", ["rated", "speed", "status", "source", "created_at_ms", "last_move_at_ms", "white_id", "black_id", "plies"])
def test_missing_required_game_fields_remain_insufficient(field):
    game = game_record()
    game[field] = None
    result = _normalize_game_result(quest_record(), enrollment_record(), game, "AbCd1234")
    assert result["outcome"] == "INSUFFICIENT_EVIDENCE"
    assert "MISSING_GAME_FIELD" in result["reason_codes"]


@pytest.mark.parametrize("status", ["started", "created", "aborted", "nostart", "cheat"])
def test_unfinished_and_disallowed_terminal_statuses_never_qualify(status):
    result = _normalize_game_result(quest_record(), enrollment_record(), game_record(status=status), "AbCd1234")
    assert result["outcome"] == "NOT_QUALIFIED"
    assert "GAME_NOT_FINISHED" in result["reason_codes"]


def test_unknown_terminal_category_is_insufficient_not_a_loss():
    result = _normalize_game_result(quest_record(), enrollment_record(), game_record(status="variantend"), "AbCd1234")
    assert result["outcome"] == "INSUFFICIENT_EVIDENCE"
    assert "UNSUPPORTED_ENDING" in result["reason_codes"]


@pytest.mark.parametrize("field,value,reason", [
    ("created_at_ms", 1_790_591_000_000, "GAME_BEFORE_ACTIVATION"),
    ("created_at_ms", 1_790_591_500_000, "GAME_BEFORE_ENROLLMENT"),
    ("last_move_at_ms", 1_790_600_000_001, "GAME_OUTSIDE_WINDOW"),
])
def test_activation_enrollment_and_play_window_are_strict(field, value, reason):
    result = _normalize_game_result(quest_record(), enrollment_record(), game_record(**{field: value}), "AbCd1234")
    assert result["outcome"] == "NOT_QUALIFIED"
    assert reason in result["reason_codes"]


def test_draw_is_not_inferred_from_missing_or_unexpected_winner():
    rules = {**GOOD_RULES, "result": "DRAW"}
    result = _normalize_game_result(quest_record(rules=rules), enrollment_record(), game_record(status="draw", winner="black"), "AbCd1234")
    assert result["outcome"] == "NOT_QUALIFIED"
    assert "RESULT_MISMATCH" in result["reason_codes"]


def test_unavailable_game_response_is_insufficient_evidence():
    result = _normalize_game_result(quest_record(), enrollment_record(), {"fetch_status": "HTTP_ERROR"}, "AbCd1234")
    assert result["outcome"] == "INSUFFICIENT_EVIDENCE"
    assert result["reason_codes"] == ["SOURCE_UNAVAILABLE"]
