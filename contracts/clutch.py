# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Clutch chess quests: consensus on rules and external Lichess evidence."""

import hashlib
import json
import re
from datetime import datetime, timezone

from genlayer import *


VERSION = "clutch/0.2.0"
SCHEMA_VERSION = "clutch-rules/1"
SOURCE_POLICY_VERSION = "lichess-standard-live/2"
STARTER_ALLOCATION = 100
MAX_REWARD = 1000
MIN_WINDOW_MS = 60 * 60 * 1000
MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
LINK_CHALLENGE_TTL_MS = 30 * 60 * 1000
CLAIM_GRACE_MS = 7 * 24 * 60 * 60 * 1000
CLAIM_COOLDOWN_MS = 2 * 60 * 1000
MAX_PLY_LIMIT = 400
STANDARD_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
ALLOWED_SOURCES = ("api", "arena", "friend", "pool", "simul", "swiss")
ALLOWED_WIN_STATUSES = ("mate", "resign", "outoftime", "timeout")
ALLOWED_DRAW_STATUSES = ("draw", "stalemate")
ALLOWED_REASON_CODES = (
    "AMBIGUOUS_RESULT",
    "VAGUE_SPEED",
    "VAGUE_TIME_LIMIT",
    "SUBJECTIVE_STRENGTH",
    "SUBJECTIVE_QUALITY",
    "UNSUPPORTED_ALTERNATIVE",
    "UNSUPPORTED_CONDITION",
    "UNSUPPORTED_MULTIGAME",
    "UNSUPPORTED_OPPONENT",
    "UNSUPPORTED_PLATFORM",
    "UNSUPPORTED_RATING_THRESHOLD",
    "UNSUPPORTED_VARIANT",
    "MISSING_RESULT",
    "MODEL_SCHEMA_INVALID",
)


def _canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _fail(code: str) -> None:
    raise gl.vm.UserError("CLUTCH|" + code)


def _need(condition: bool, code: str) -> None:
    if not condition:
        _fail(code)


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _compiler_prompt(description: str) -> str:
    return f"""Compile the sponsor's chess-quest description into the Clutch {SCHEMA_VERSION} schema.

Return one JSON object and no markdown:
{{"status":"COMPILED|NEEDS_CLARIFICATION|UNSUPPORTED","rules":{{...}} or null,"reason_codes":[...]}}

For COMPILED, rules must have exactly these required keys and values:
platform="LICHESS"; variant="STANDARD"; rated="ANY|REQUIRED|FORBIDDEN";
speed="ANY|BULLET|BLITZ|RAPID|CLASSICAL";
player_color="ANY|WHITE|BLACK"; result="WIN|DRAW".
Optional max_plies is an integer from 1 to {MAX_PLY_LIMIT}.

Convert a stated maximum in full moves into half-moves (plies): 40 full moves is 80 plies. A stated half-move limit is already plies. Never guess a missing or vague threshold.

Use conjunctions only. Never drop, weaken, invent, or silently normalize away a requirement. Use NEEDS_CLARIFICATION for vague time/speed or missing outcome. Use UNSUPPORTED for alternatives, multiple games, subjective strength/quality, rating thresholds, non-Lichess platform, non-standard variant, opponent conditions, or any condition outside the schema. If a requirement cannot be represented exactly, reject it instead of discarding it.

Reason codes are one to three distinct values from: {", ".join(ALLOWED_REASON_CODES)}.
For non-COMPILED outcomes set rules to null. For COMPILED set reason_codes to an empty array. Assume Lichess standard chess only when the text does not request another platform or variant. Do not infer WIN or DRAW when the outcome is unstated.

Description:
{description}"""


def _normalize_compilation_shape(response: dict) -> dict:
    """Fill the safe null-rules field omitted in some noncompiled model answers."""
    normalized = dict(response)
    if normalized.get("status") in ("NEEDS_CLARIFICATION", "UNSUPPORTED") and "rules" not in normalized:
        normalized["rules"] = None
    return normalized


def _independent_compilation(description: str) -> str:
    response = gl.nondet.exec_prompt(_compiler_prompt(description), response_format="json")
    if isinstance(response, str):
        try:
            response = json.loads(response)
        except Exception:
            return ""
    if not isinstance(response, dict):
        return ""
    response = _normalize_compilation_shape(response)
    return _canonical(response)


def _comparison_key(result: dict) -> str:
    if not isinstance(result, dict):
        return ""
    status = result.get("status")
    codes = result.get("reason_codes")
    if not isinstance(status, str) or not isinstance(codes, list):
        return ""
    if status == "COMPILED":
        rules = result.get("rules")
        if not isinstance(rules, dict):
            return ""
        return _canonical({"status": status, "rules": rules, "reason_codes": codes})
    return _canonical({"status": status, "rules": None, "reason_codes": codes})


def _valid_compilation(result: dict) -> bool:
    if not isinstance(result, dict):
        return False
    if len(result) != 3 or "status" not in result or "rules" not in result or "reason_codes" not in result:
        return False
    status = result.get("status")
    codes = result.get("reason_codes")
    if not isinstance(codes, list) or len(codes) > 3:
        return False
    for code in codes:
        if not isinstance(code, str) or code not in ALLOWED_REASON_CODES:
            return False
    if status == "COMPILED":
        if codes or not isinstance(result.get("rules"), dict):
            return False
        rules = result["rules"]
        required = ("platform", "variant", "rated", "speed", "player_color", "result")
        allowed = required + ("max_plies",)
        for key in rules:
            if key not in allowed:
                return False
        for key in required:
            if key not in rules:
                return False
        if len(rules) < len(required) or len(rules) > len(allowed):
            return False
        if rules.get("platform") != "LICHESS" or rules.get("variant") != "STANDARD":
            return False
        if rules.get("rated") not in ("ANY", "REQUIRED", "FORBIDDEN"):
            return False
        if rules.get("speed") not in ("ANY", "BULLET", "BLITZ", "RAPID", "CLASSICAL"):
            return False
        if rules.get("player_color") not in ("ANY", "WHITE", "BLACK"):
            return False
        if rules.get("result") not in ("WIN", "DRAW"):
            return False
        if "max_plies" in rules:
            limit = rules["max_plies"]
            if not _is_int(limit) or limit < 1 or limit > MAX_PLY_LIMIT:
                return False
        return True
    if status not in ("NEEDS_CLARIFICATION", "UNSUPPORTED"):
        return False
    if result.get("rules") is not None or len(codes) < 1:
        return False
    for index, code in enumerate(codes):
        for previous in codes[:index]:
            if previous == code:
                return False
    return True


def _quest_hash_payload(quest: dict) -> dict:
    bot_demo = quest.get("participant_policy", "HUMAN_ONLY") == "BOT_DEMO"
    relative = quest.get("window_mode", "SCHEDULED") == "ACTIVATION_RELATIVE"
    return {
        "chain_id": int(gl.message.chain_id),
        "contract_address": gl.message.contract_address.as_hex.lower(),
        "quest_id": quest["id"],
        "sponsor": quest["sponsor"],
        "description": quest["description"],
        "schema_version": SCHEMA_VERSION,
        "rules": quest["rules"],
        "source_policy": SOURCE_POLICY_VERSION,
        "source_policy_definition": {
            "endpoint": "https://lichess.org/game/export/{gameId}",
            "allowed_sources": list(ALLOWED_SOURCES),
            "win_statuses": list(ALLOWED_WIN_STATUSES),
            "draw_statuses": list(ALLOWED_DRAW_STATUSES),
            "recognized_bot_games": "required_both_accounts" if bot_demo else "excluded",
            "casual_only": bot_demo,
            "imported_position_and_relay_games": "excluded",
            "move_unit": "half-moves",
        },
        "reward_demo_units": int(quest["reward"]),
        "participant_policy": quest.get("participant_policy", "HUMAN_ONLY"),
        "window_mode": quest.get("window_mode", "SCHEDULED"),
        "play_window_start_ms": "activation timestamp" if relative else int(quest["starts_at_ms"]),
        "play_window_end_ms": "activation timestamp + duration" if relative else int(quest["ends_at_ms"]),
        "window_duration_ms": int(quest.get("window_duration_ms", 0)),
        "claim_grace_ms": CLAIM_GRACE_MS,
        "activation_time": "transaction timestamp of confirm_and_activate",
    }


def _normalize_game_data(game_id: str, response) -> dict:
    if response.status != 200 or response.body is None:
        return {"fetch_status": "HTTP_ERROR", "http_status": response.status}
    try:
        data = json.loads(response.body.decode("utf-8"))
    except Exception:
        return {"fetch_status": "INVALID_JSON", "http_status": response.status}
    if not isinstance(data, dict):
        return {"fetch_status": "INVALID_JSON", "http_status": response.status}

    players = data.get("players")
    if not isinstance(players, dict):
        players = {}
    white = players.get("white")
    black = players.get("black")
    if not isinstance(white, dict):
        white = {}
    if not isinstance(black, dict):
        black = {}
    white_user = white.get("user")
    black_user = black.get("user")
    if not isinstance(white_user, dict):
        white_user = {}
    if not isinstance(black_user, dict):
        black_user = {}
    moves = data.get("moves")
    plies = None
    if isinstance(moves, str):
        plies = len(moves.split())

    game_record_id = data.get("id")
    rated = data.get("rated")
    variant = data.get("variant")
    speed = data.get("speed")
    status = data.get("status")
    source = data.get("source")
    winner = data.get("winner")
    start_ms = data.get("createdAt")
    complete_ms = data.get("lastMoveAt")
    initial_fen = data.get("initialFen")

    return {
        "fetch_status": "OK",
        "id": game_record_id if isinstance(game_record_id, str) else None,
        "rated": rated if isinstance(rated, bool) else None,
        "variant": variant.lower() if isinstance(variant, str) else None,
        "speed": speed.lower() if isinstance(speed, str) else None,
        "status": status.lower() if isinstance(status, str) else None,
        "source": source.lower() if isinstance(source, str) else None,
        "winner": winner.lower() if isinstance(winner, str) else None,
        "created_at_ms": start_ms if _is_int(start_ms) and start_ms > 0 else None,
        "last_move_at_ms": complete_ms if _is_int(complete_ms) and complete_ms > 0 else None,
        "white_id": white_user.get("id").lower() if isinstance(white_user.get("id"), str) else None,
        "black_id": black_user.get("id").lower() if isinstance(black_user.get("id"), str) else None,
        "white_bot": white_user.get("title") == "BOT",
        "black_bot": black_user.get("title") == "BOT",
        "plies": plies,
        "initial_fen": initial_fen if isinstance(initial_fen, str) else None,
    }


def _fetch_game(game_id: str) -> str:
    url = (
        "https://lichess.org/game/export/"
        + game_id
        + "?moves=true&tags=true&clocks=false&evals=false&opening=false"
    )
    response = gl.nondet.web.get(
        url,
        headers={"Accept": "application/json", "User-Agent": "Clutch/0.1"},
    )
    return _canonical(_normalize_game_data(game_id, response))


def _fetch_profile(user_id: str, challenge_text: str) -> str:
    url = "https://lichess.org/api/user/" + user_id + "?profile=true"
    response = gl.nondet.web.get(
        url,
        headers={"Accept": "application/json", "User-Agent": "Clutch/0.1"},
    )
    if response.status != 200 or response.body is None:
        return _canonical({"fetch_status": "HTTP_ERROR", "http_status": response.status})
    try:
        data = json.loads(response.body.decode("utf-8"))
    except Exception:
        return _canonical({"fetch_status": "INVALID_JSON", "http_status": response.status})
    if not isinstance(data, dict):
        return _canonical({"fetch_status": "INVALID_JSON", "http_status": response.status})
    profile = data.get("profile")
    if not isinstance(profile, dict):
        profile = {}
    returned_id = data.get("id")
    bio = profile.get("bio")
    if not isinstance(returned_id, str) or not isinstance(bio, str):
        return _canonical({"fetch_status": "MISSING_PROFILE_FIELD"})
    return _canonical({
        "fetch_status": "OK",
        "id": returned_id.lower(),
        "challenge_visible": challenge_text in bio,
    })


def _record_check(checks: list, label: str, passed: bool, code: str, observed) -> None:
    checks.append({
        "condition": label,
        "status": "PASS" if passed else "FAIL",
        "reason_code": "" if passed else code,
        "observed": observed,
    })


def _normalize_game_result(quest: dict, enrollment: dict, game: dict, requested_game_id: str) -> dict:
    checks = []
    reasons = []
    if game.get("fetch_status") != "OK":
        status = game.get("fetch_status")
        code = "SOURCE_UNAVAILABLE" if status == "HTTP_ERROR" else "SOURCE_BAD_RESPONSE"
        checks.append({"condition": "Lichess response", "status": "INSUFFICIENT_EVIDENCE", "reason_code": code, "observed": status})
        return {"outcome": "INSUFFICIENT_EVIDENCE", "reason_codes": [code], "checks": checks}

    required = (
        "id",
        "rated",
        "variant",
        "speed",
        "status",
        "source",
        "created_at_ms",
        "last_move_at_ms",
        "white_id",
        "black_id",
        "plies",
    )
    missing = []
    for field in required:
        if game.get(field) is None:
            missing.append(field)
            checks.append({
                "condition": field,
                "status": "INSUFFICIENT_EVIDENCE",
                "reason_code": "MISSING_GAME_FIELD",
                "observed": None,
            })
    if missing:
        return {"outcome": "INSUFFICIENT_EVIDENCE", "reason_codes": ["MISSING_GAME_FIELD"], "checks": checks}

    game_id_matches = game["id"] == requested_game_id
    _record_check(checks, "Returned game ID", game_id_matches, "WRONG_GAME_ID", game["id"])
    if not game_id_matches:
        reasons.append("WRONG_GAME_ID")

    source_allowed = game["source"] in ALLOWED_SOURCES
    _record_check(checks, "Allowed live-game source", source_allowed, "GAME_SOURCE_DISALLOWED", game["source"])
    if not source_allowed:
        reasons.append("GAME_SOURCE_DISALLOWED")

    standard_variant = game["variant"] == "standard"
    _record_check(checks, "Standard chess", standard_variant, "VARIANT_MISMATCH", game["variant"])
    if not standard_variant:
        reasons.append("VARIANT_MISMATCH")

    initial_fen = game.get("initial_fen")
    standard_start = initial_fen is None or initial_fen in ("startpos", STANDARD_FEN)
    _record_check(checks, "Standard starting position", standard_start, "INVALID_VARIANT_START", initial_fen)
    if not standard_start:
        reasons.append("INVALID_VARIANT_START")

    bot_demo = quest.get("participant_policy", "HUMAN_ONLY") == "BOT_DEMO"
    if bot_demo:
        both_bots = game["white_bot"] and game["black_bot"]
        _record_check(checks, "Two BOT accounts (automated demo)", both_bots, "BOT_ACCOUNTS_REQUIRED", {"white": game["white_bot"], "black": game["black_bot"]})
        if not both_bots:
            reasons.append("BOT_ACCOUNTS_REQUIRED")
        casual = game["rated"] is False
        _record_check(checks, "Casual bot demo", casual, "BOT_DEMO_MUST_BE_CASUAL", game["rated"])
        if not casual:
            reasons.append("BOT_DEMO_MUST_BE_CASUAL")
    else:
        no_bots = not game["white_bot"] and not game["black_bot"]
        _record_check(checks, "No bot accounts", no_bots, "BOT_GAME_DISALLOWED", {"white": game["white_bot"], "black": game["black_bot"]})
        if not no_bots:
            reasons.append("BOT_GAME_DISALLOWED")

    status = game["status"]
    is_win_terminal = status in ALLOWED_WIN_STATUSES
    is_draw_terminal = status in ALLOWED_DRAW_STATUSES
    is_finished_category = is_win_terminal or is_draw_terminal
    if status in ("started", "created", "aborted", "nostart", "cheat"):
        checks.append({"condition": "Finished game", "status": "FAIL", "reason_code": "GAME_NOT_FINISHED", "observed": status})
        reasons.append("GAME_NOT_FINISHED")
        is_finished_category = True
    elif is_finished_category:
        _record_check(checks, "Finished game category", True, "UNSUPPORTED_ENDING", status)
    else:
        checks.append({"condition": "Finished game category", "status": "INSUFFICIENT_EVIDENCE", "reason_code": "UNSUPPORTED_ENDING", "observed": status})
        return {"outcome": "INSUFFICIENT_EVIDENCE", "reason_codes": ["UNSUPPORTED_ENDING"], "checks": checks}

    claimant_id = enrollment["lichess_id"]
    color = "WHITE" if game["white_id"] == claimant_id else "BLACK" if game["black_id"] == claimant_id else "NONE"
    claimant_present = color != "NONE"
    _record_check(checks, "Enrolled Lichess account", claimant_present, "CLAIMANT_NOT_IN_GAME", {"enrolled": claimant_id, "color": color})
    if not claimant_present:
        reasons.append("CLAIMANT_NOT_IN_GAME")

    rules = quest["rules"]
    color_matches = rules["player_color"] == "ANY" or rules["player_color"] == color
    _record_check(checks, "Player color", color_matches, "COLOR_MISMATCH", color)
    if not color_matches:
        reasons.append("COLOR_MISMATCH")

    rated = game["rated"]
    rated_matches = rules["rated"] == "ANY" or (rules["rated"] == "REQUIRED" and rated) or (rules["rated"] == "FORBIDDEN" and not rated)
    _record_check(checks, "Rated status", rated_matches, "RATED_MISMATCH", rated)
    if not rated_matches:
        reasons.append("RATED_MISMATCH")

    speed = game["speed"]
    speed_name = speed.upper()
    speed_matches = rules["speed"] == "ANY" or rules["speed"] == speed_name
    _record_check(checks, "Time control", speed_matches, "SPEED_MISMATCH", speed)
    if not speed_matches:
        reasons.append("SPEED_MISMATCH")

    if rules["result"] == "WIN":
        winner_color = game.get("winner")
        result_matches = is_win_terminal and winner_color == color.lower() and color != "NONE"
        result_observed = {"status": status, "winner": winner_color}
    else:
        result_matches = is_draw_terminal and game.get("winner") is None
        result_observed = {"status": status, "winner": game.get("winner")}
    _record_check(checks, "Game result", result_matches, "RESULT_MISMATCH", result_observed)
    if not result_matches:
        reasons.append("RESULT_MISMATCH")

    started_after_activation = game["created_at_ms"] > int(quest["activated_at_ms"])
    _record_check(checks, "Game started after activation", started_after_activation, "GAME_BEFORE_ACTIVATION", game["created_at_ms"])
    if not started_after_activation:
        reasons.append("GAME_BEFORE_ACTIVATION")

    started_after_enrollment = game["created_at_ms"] > int(enrollment["enrolled_at_ms"])
    _record_check(checks, "Game started after enrollment", started_after_enrollment, "GAME_BEFORE_ENROLLMENT", game["created_at_ms"])
    if not started_after_enrollment:
        reasons.append("GAME_BEFORE_ENROLLMENT")

    within_play_window = (
        game["created_at_ms"] >= int(quest["starts_at_ms"])
        and game["last_move_at_ms"] >= game["created_at_ms"]
        and game["last_move_at_ms"] <= int(quest["ends_at_ms"])
    )
    _record_check(checks, "Game completed in play window", within_play_window, "GAME_OUTSIDE_WINDOW", {
        "started_at_ms": game["created_at_ms"],
        "completed_at_ms": game["last_move_at_ms"],
        "ends_at_ms": quest["ends_at_ms"],
    })
    if not within_play_window:
        reasons.append("GAME_OUTSIDE_WINDOW")

    plies = game["plies"]
    has_moves = _is_int(plies) and plies > 0
    _record_check(checks, "Move list", has_moves, "MISSING_GAME_FIELD", plies)
    if not has_moves:
        reasons.append("MISSING_GAME_FIELD")

    max_plies = rules.get("max_plies")
    within_move_limit = max_plies is None or plies <= max_plies
    _record_check(checks, "Maximum half-moves", within_move_limit, "MAX_PLIES_EXCEEDED", {"plies": plies, "max_plies": max_plies})
    if not within_move_limit:
        reasons.append("MAX_PLIES_EXCEEDED")

    if not has_moves:
        outcome = "INSUFFICIENT_EVIDENCE"
    elif reasons:
        outcome = "NOT_QUALIFIED"
    else:
        outcome = "VERIFIED"
    unique_reasons = []
    for code in reasons:
        if code not in unique_reasons:
            unique_reasons.append(code)
    return {"outcome": outcome, "reason_codes": unique_reasons[:8], "checks": checks}


class Clutch(gl.Contract):
    quest_ids: DynArray[str]
    quests: TreeMap[str, str]
    balances: TreeMap[str, u256]
    awarded_balances: TreeMap[str, u256]
    starter_claimed: TreeMap[str, bool]
    link_challenges: TreeMap[str, str]
    active_challenges: TreeMap[str, str]
    link_request_counts: TreeMap[str, u256]
    wallet_to_lichess: TreeMap[str, str]
    lichess_to_wallet: TreeMap[str, str]
    enrollments: TreeMap[str, str]
    claims: TreeMap[str, str]
    claim_counts: TreeMap[str, u256]
    last_attempt_ms: TreeMap[str, u256]
    latest_game_attempt: TreeMap[str, str]
    reserved_by_sponsor: TreeMap[str, u256]
    quest_counter: u256
    total_issued: u256
    total_available: u256
    total_reserved: u256
    total_awarded: u256
    total_refunded: u256

    def __init__(self):
        self.quest_counter = 0
        self.total_issued = 0
        self.total_available = 0
        self.total_reserved = 0
        self.total_awarded = 0
        self.total_refunded = 0

    def _wallet(self) -> str:
        return gl.message.sender_address.as_hex.lower()

    def _quest(self, quest_id: str) -> dict:
        raw = self.quests.get(quest_id, "")
        if not raw:
            _fail("UNKNOWN_QUEST")
        return json.loads(raw)

    def _save_quest(self, quest_id: str, quest: dict) -> None:
        self.quests[quest_id] = _canonical(quest)

    def _require_sponsor(self, quest: dict) -> None:
        _need(quest["sponsor"] == self._wallet(), "ONLY_SPONSOR")

    def _validate_window(self, starts_at_ms: int, ends_at_ms: int, now_ms: int) -> None:
        _need(_is_int(starts_at_ms) and _is_int(ends_at_ms), "INVALID_TIME_WINDOW")
        _need(starts_at_ms >= now_ms, "PLAY_START_IN_PAST")
        _need(starts_at_ms <= now_ms + MAX_WINDOW_MS, "PLAY_START_TOO_FAR")
        _need(ends_at_ms >= starts_at_ms + MIN_WINDOW_MS, "PLAY_WINDOW_TOO_SHORT")
        _need(ends_at_ms <= starts_at_ms + MAX_WINDOW_MS, "PLAY_WINDOW_TOO_LONG")

    def _validate_reward(self, reward: int) -> None:
        _need(_is_int(reward) and reward >= 1 and reward <= MAX_REWARD, "INVALID_REWARD")

    def _compile(self, description: str) -> dict:
        def leader_fn():
            return _independent_compilation(description)

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            try:
                proposed = json.loads(leader_result.calldata)
                independent = json.loads(_independent_compilation(description))
                return _comparison_key(proposed) != "" and _comparison_key(proposed) == _comparison_key(independent)
            except Exception:
                return False

        if hasattr(gl.vm, "run_nondet_unsafe"):
            agreed = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        else:
            agreed = gl.vm.run_nondet(leader_fn, validator_fn)
        try:
            result = json.loads(agreed)
        except Exception:
            _fail("MODEL_SCHEMA_INVALID")
        _need(_valid_compilation(result), "MODEL_SCHEMA_INVALID")
        return result

    def _agreed_game_json(self, game_id: str) -> str:
        def fetch_game():
            return _fetch_game(game_id)

        return gl.eq_principle.strict_eq(fetch_game)

    def _rule_hash(self, quest: dict) -> str:
        payload = _canonical(_quest_hash_payload(quest))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _next_claim_id(self, quest_id: str, index: int) -> str:
        return quest_id + "-claim-" + str(index + 1)

    @gl.public.view
    def get_contract_info(self) -> dict:
        return {
            "version": VERSION,
            "schema_version": SCHEMA_VERSION,
            "source_policy_version": SOURCE_POLICY_VERSION,
            "runner": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6",
            "chain_id": int(gl.message.chain_id),
            "contract": gl.message.contract_address.as_hex,
            "claim_grace_ms": CLAIM_GRACE_MS,
            "claim_cooldown_ms": CLAIM_COOLDOWN_MS,
            "participant_modes": ["HUMAN_ONLY", "BOT_DEMO"],
        }

    @gl.public.view
    def get_account(self, wallet: str) -> dict:
        normalized = wallet.lower()
        return {
            "wallet": normalized,
            "sponsor_available": int(self.balances.get(normalized, 0)),
            "awarded": int(self.awarded_balances.get(normalized, 0)),
            "starter_claimed": bool(self.starter_claimed.get(normalized, False)),
            "total_issued": int(self.total_issued),
            "total_available": int(self.total_available),
            "total_reserved": int(self.total_reserved),
            "total_awarded": int(self.total_awarded),
            "total_refunded": int(self.total_refunded),
        }

    @gl.public.write
    def claim_starter_allocation(self) -> int:
        wallet = self._wallet()
        _need(not self.starter_claimed.get(wallet, False), "STARTER_ALREADY_CLAIMED")
        self.starter_claimed[wallet] = True
        self.balances[wallet] = int(self.balances.get(wallet, 0)) + STARTER_ALLOCATION
        self.total_issued += STARTER_ALLOCATION
        self.total_available += STARTER_ALLOCATION
        return STARTER_ALLOCATION

    def _create_draft(self, description: str, reward: int, starts_at_ms: int, ends_at_ms: int, participant_policy: str, duration_ms: int) -> str:
        wallet = self._wallet()
        _need(isinstance(description, str) and 8 <= len(description) <= 1000, "INVALID_DESCRIPTION")
        self._validate_reward(reward)
        now_ms = _now_ms()
        if participant_policy == "BOT_DEMO":
            _need(_is_int(duration_ms) and MIN_WINDOW_MS <= duration_ms <= MAX_WINDOW_MS, "INVALID_PLAY_WINDOW")
        else:
            self._validate_window(starts_at_ms, ends_at_ms, now_ms)
        _need(int(self.balances.get(wallet, 0)) >= reward, "INSUFFICIENT_DEMO_BALANCE")
        self.quest_counter += 1
        quest_id = "quest-" + str(int(self.quest_counter))
        quest = {
            "id": quest_id,
            "sponsor": wallet,
            "description": description.strip(),
            "participant_policy": participant_policy,
            "window_mode": "ACTIVATION_RELATIVE" if participant_policy == "BOT_DEMO" else "SCHEDULED",
            "window_duration_ms": duration_ms,
            "state": "DRAFT",
            "compile_status": "",
            "reason_codes": [],
            "rules": None,
            "rule_hash": "",
            "reward": int(reward),
            "starts_at_ms": int(starts_at_ms),
            "ends_at_ms": int(ends_at_ms),
            "activated_at_ms": 0,
            "claim_deadline_ms": 0,
            "claim_grace_ms": CLAIM_GRACE_MS,
            "winner": "",
            "winning_claim_id": "",
            "created_at_ms": now_ms,
        }
        self._save_quest(quest_id, quest)
        self.quest_ids.append(quest_id)
        return quest_id

    @gl.public.write
    def create_draft(self, description: str, reward: int, starts_at_ms: int, ends_at_ms: int) -> str:
        return self._create_draft(description, reward, starts_at_ms, ends_at_ms, "HUMAN_ONLY", 0)

    @gl.public.write
    def create_bot_demo_draft(self, description: str, reward: int, window_duration_ms: int) -> str:
        """Explicit casual BOT demo; the frozen duration opens on activation."""
        return self._create_draft(description, reward, 0, 0, "BOT_DEMO", window_duration_ms)

    @gl.public.write
    def update_draft(self, quest_id: str, description: str, reward: int, starts_at_ms: int, ends_at_ms: int) -> bool:
        quest = self._quest(quest_id)
        self._require_sponsor(quest)
        _need(quest["state"] in ("DRAFT", "COMPILED"), "QUEST_IMMUTABLE")
        _need(quest.get("participant_policy", "HUMAN_ONLY") == "HUMAN_ONLY", "BOT_DEMO_DRAFT_IMMUTABLE")
        _need(isinstance(description, str) and 8 <= len(description) <= 1000, "INVALID_DESCRIPTION")
        self._validate_reward(reward)
        self._validate_window(starts_at_ms, ends_at_ms, _now_ms())
        _need(int(self.balances.get(quest["sponsor"], 0)) >= reward, "INSUFFICIENT_DEMO_BALANCE")
        quest["description"] = description.strip()
        quest["reward"] = int(reward)
        quest["starts_at_ms"] = int(starts_at_ms)
        quest["ends_at_ms"] = int(ends_at_ms)
        quest["state"] = "DRAFT"
        quest["compile_status"] = ""
        quest["reason_codes"] = []
        quest["rules"] = None
        quest["rule_hash"] = ""
        self._save_quest(quest_id, quest)
        return True

    @gl.public.write
    def compile_draft(self, quest_id: str) -> dict:
        quest = self._quest(quest_id)
        self._require_sponsor(quest)
        _need(quest["state"] == "DRAFT", "DRAFT_REQUIRED")
        result = self._compile(quest["description"])
        quest["compile_status"] = result["status"]
        quest["reason_codes"] = result["reason_codes"]
        if result["status"] == "COMPILED":
            quest["rules"] = result["rules"]
            quest["state"] = "COMPILED"
            quest["rule_hash"] = self._rule_hash(quest)
        else:
            quest["rules"] = None
            quest["state"] = "DRAFT"
            quest["rule_hash"] = ""
        self._save_quest(quest_id, quest)
        return {
            "status": result["status"],
            "rules": result["rules"],
            "reason_codes": result["reason_codes"],
            "rule_hash": quest["rule_hash"],
        }

    @gl.public.write
    def confirm_and_activate(self, quest_id: str, confirmed_hash: str) -> bool:
        quest = self._quest(quest_id)
        self._require_sponsor(quest)
        _need(quest["state"] == "COMPILED" and quest["compile_status"] == "COMPILED", "COMPILED_QUEST_REQUIRED")
        _need(isinstance(confirmed_hash, str) and re.fullmatch(r"[a-f0-9]{64}", confirmed_hash) is not None, "INVALID_CONFIRMATION_HASH")
        current_hash = self._rule_hash(quest)
        _need(confirmed_hash == current_hash and current_hash == quest["rule_hash"], "CONFIRMATION_HASH_MISMATCH")
        now_ms = _now_ms()
        if quest.get("window_mode") == "ACTIVATION_RELATIVE":
            duration_ms = int(quest["window_duration_ms"])
            _need(MIN_WINDOW_MS <= duration_ms <= MAX_WINDOW_MS, "INVALID_PLAY_WINDOW")
            quest["starts_at_ms"] = now_ms
            quest["ends_at_ms"] = now_ms + duration_ms
        else:
            _need(now_ms <= quest["starts_at_ms"], "PLAY_WINDOW_ALREADY_STARTED")
            _need(now_ms < quest["ends_at_ms"], "PLAY_WINDOW_EXPIRED")
        self._validate_reward(quest["reward"])
        sponsor = quest["sponsor"]
        available = int(self.balances.get(sponsor, 0))
        reward = int(quest["reward"])
        _need(available >= reward, "INSUFFICIENT_DEMO_BALANCE")
        self.balances[sponsor] = available - reward
        self.reserved_by_sponsor[sponsor] = int(self.reserved_by_sponsor.get(sponsor, 0)) + reward
        self.total_available -= reward
        self.total_reserved += reward
        quest["activated_at_ms"] = now_ms
        quest["claim_deadline_ms"] = int(quest["ends_at_ms"]) + CLAIM_GRACE_MS
        quest["state"] = "ACTIVE"
        quest["activation_hash"] = current_hash
        self._save_quest(quest_id, quest)
        return True

    @gl.public.view
    def get_quest(self, quest_id: str) -> dict:
        return self._quest(quest_id)

    @gl.public.view
    def list_quests(self, offset: int, limit: int) -> list:
        _need(_is_int(offset) and offset >= 0, "INVALID_OFFSET")
        _need(_is_int(limit) and 1 <= limit <= 50, "INVALID_LIMIT")
        result = []
        count = len(self.quest_ids)
        end = min(count, offset + limit)
        index = offset
        while index < end:
            quest_id = self.quest_ids[index]
            result.append(self._quest(quest_id))
            index += 1
        return result

    @gl.public.view
    def get_quest_count(self) -> int:
        return len(self.quest_ids)

    @gl.public.write
    def request_link_challenge(self, lichess_id: str) -> dict:
        wallet = self._wallet()
        normalized = lichess_id.lower().strip() if isinstance(lichess_id, str) else ""
        _need(re.fullmatch(r"[a-z0-9_-]{3,30}", normalized) is not None, "INVALID_LICHESS_ID")
        _need(not self.wallet_to_lichess.get(wallet, ""), "WALLET_ALREADY_LINKED")
        existing_wallet = self.lichess_to_wallet.get(normalized, "")
        _need(not existing_wallet or existing_wallet == wallet, "LICHESS_ACCOUNT_ALREADY_LINKED")
        now_ms = _now_ms()
        request_count = int(self.link_request_counts.get(wallet, 0)) + 1
        self.link_request_counts[wallet] = request_count
        chain_id = int(gl.message.chain_id)
        contract_address = gl.message.contract_address.as_hex.lower()
        nonce_seed = f"{chain_id}|{contract_address}|{wallet}|{normalized}|{now_ms}|{request_count}"
        nonce = hashlib.sha256(nonce_seed.encode("utf-8")).hexdigest()[:32]
        challenge_text = (
            "CLUTCH LINK V1 | chain=" + str(chain_id)
            + " | contract=" + contract_address
            + " | wallet=" + wallet
            + " | lichess=" + normalized
            + " | nonce=" + nonce
        )
        challenge = {
            "nonce": nonce,
            "wallet": wallet,
            "lichess_id": normalized,
            "text": challenge_text,
            "requested_at_ms": now_ms,
            "expires_at_ms": now_ms + LINK_CHALLENGE_TTL_MS,
            "state": "PENDING",
        }
        active = self.active_challenges.get(wallet, "")
        if active:
            old_raw = self.link_challenges.get(active, "")
            if old_raw:
                old = json.loads(old_raw)
                if old["state"] == "PENDING":
                    old["state"] = "SUPERSEDED"
                    self.link_challenges[active] = _canonical(old)
        self.link_challenges[nonce] = _canonical(challenge)
        self.active_challenges[wallet] = nonce
        return challenge

    @gl.public.view
    def get_link_challenge(self, nonce: str) -> dict:
        raw = self.link_challenges.get(nonce, "")
        if not raw:
            _fail("UNKNOWN_LINK_CHALLENGE")
        return json.loads(raw)

    @gl.public.view
    def get_active_link_challenge(self, wallet: str) -> dict:
        normalized = wallet.lower()
        nonce = self.active_challenges.get(normalized, "")
        raw = self.link_challenges.get(nonce, "") if nonce else ""
        if not raw:
            _fail("NO_ACTIVE_CHALLENGE")
        return json.loads(raw)

    @gl.public.view
    def get_my_link(self) -> dict:
        wallet = self._wallet()
        return {"wallet": wallet, "lichess_id": self.wallet_to_lichess.get(wallet, "")}

    @gl.public.view
    def get_link_for_wallet(self, wallet: str) -> dict:
        normalized = wallet.lower()
        return {"wallet": normalized, "lichess_id": self.wallet_to_lichess.get(normalized, "")}

    @gl.public.view
    def get_wallet_for_lichess(self, lichess_id: str) -> str:
        return self.lichess_to_wallet.get(lichess_id.lower(), "")

    @gl.public.write
    def verify_link_challenge(self, nonce: str) -> dict:
        wallet = self._wallet()
        raw = self.link_challenges.get(nonce, "")
        _need(bool(raw), "UNKNOWN_LINK_CHALLENGE")
        challenge = json.loads(raw)
        _need(challenge["wallet"] == wallet, "ONLY_REQUESTING_WALLET")
        _need(self.active_challenges.get(wallet, "") == nonce, "CHALLENGE_NOT_ACTIVE")
        _need(challenge["state"] == "PENDING", "CHALLENGE_NOT_PENDING")
        now_ms = _now_ms()
        _need(now_ms <= challenge["expires_at_ms"], "CHALLENGE_EXPIRED")
        normalized = challenge["lichess_id"]
        challenge_text = challenge["text"]
        existing_wallet = self.lichess_to_wallet.get(normalized, "")
        _need(not existing_wallet or existing_wallet == wallet, "LICHESS_ACCOUNT_ALREADY_LINKED")

        def read_profile():
            return _fetch_profile(normalized, challenge_text)

        agreed = gl.eq_principle.strict_eq(read_profile)
        try:
            profile = json.loads(agreed)
        except Exception:
            return {"verified": False, "reason_code": "PROFILE_BAD_RESPONSE", "lichess_id": normalized}
        if profile.get("fetch_status") != "OK":
            code = "PROFILE_SOURCE_UNAVAILABLE" if profile.get("fetch_status") == "HTTP_ERROR" else "PROFILE_INSUFFICIENT_EVIDENCE"
            return {"verified": False, "reason_code": code, "lichess_id": normalized}
        if profile.get("id") != normalized:
            return {"verified": False, "reason_code": "PROFILE_ID_MISMATCH", "lichess_id": normalized}
        if profile.get("challenge_visible") is not True:
            return {"verified": False, "reason_code": "CHALLENGE_NOT_VISIBLE", "lichess_id": normalized}

        _need(not self.wallet_to_lichess.get(wallet, ""), "WALLET_ALREADY_LINKED")
        _need(not self.lichess_to_wallet.get(normalized, ""), "LICHESS_ACCOUNT_ALREADY_LINKED")
        self.wallet_to_lichess[wallet] = normalized
        self.lichess_to_wallet[normalized] = wallet
        challenge["state"] = "VERIFIED"
        challenge["verified_at_ms"] = now_ms
        self.link_challenges[nonce] = _canonical(challenge)
        return {"verified": True, "reason_code": "", "lichess_id": normalized, "wallet": wallet, "verified_at_ms": now_ms}

    @gl.public.write
    def join_quest(self, quest_id: str) -> dict:
        quest = self._quest(quest_id)
        _need(quest["state"] == "ACTIVE", "QUEST_NOT_ACTIVE")
        wallet = self._wallet()
        lichess_id = self.wallet_to_lichess.get(wallet, "")
        _need(bool(lichess_id), "VERIFIED_LICHESS_LINK_REQUIRED")
        now_ms = _now_ms()
        _need(now_ms >= quest["starts_at_ms"], "PLAY_WINDOW_NOT_OPEN")
        _need(now_ms <= quest["ends_at_ms"], "PLAY_WINDOW_CLOSED")
        key = quest_id + "|" + wallet
        _need(not self.enrollments.get(key, ""), "ALREADY_ENROLLED")
        enrollment = {
            "quest_id": quest_id,
            "wallet": wallet,
            "lichess_id": lichess_id,
            "enrolled_at_ms": now_ms,
        }
        self.enrollments[key] = _canonical(enrollment)
        return enrollment

    @gl.public.view
    def get_enrollment(self, quest_id: str, wallet: str) -> dict:
        key = quest_id + "|" + wallet.lower()
        raw = self.enrollments.get(key, "")
        if not raw:
            return {"enrolled": False, "quest_id": quest_id, "wallet": wallet.lower()}
        record = json.loads(raw)
        record["enrolled"] = True
        return record

    @gl.public.write
    def submit_game(self, quest_id: str, game_id: str) -> dict:
        quest = self._quest(quest_id)
        _need(quest["state"] == "ACTIVE", "QUEST_NOT_ACTIVE")
        wallet = self._wallet()
        now_ms = _now_ms()
        _need(now_ms <= quest["claim_deadline_ms"], "CLAIM_DEADLINE_PASSED")
        _need(isinstance(game_id, str) and re.fullmatch(r"[A-Za-z0-9]{8}", game_id) is not None, "INVALID_GAME_ID")
        enrollment_key = quest_id + "|" + wallet
        enrollment_raw = self.enrollments.get(enrollment_key, "")
        _need(bool(enrollment_raw), "ENROLLMENT_REQUIRED")
        enrollment = json.loads(enrollment_raw)
        latest_key = quest_id + "|" + game_id
        previous_outcome = self.latest_game_attempt.get(latest_key, "")
        _need(previous_outcome in ("", "INSUFFICIENT_EVIDENCE"), "GAME_ALREADY_PROCESSED")
        last_attempt = int(self.last_attempt_ms.get(enrollment_key, 0))
        _need(last_attempt == 0 or now_ms >= last_attempt + CLAIM_COOLDOWN_MS, "CLAIM_RETRY_COOLDOWN")

        agreed_json = self._agreed_game_json(game_id)
        try:
            game = json.loads(agreed_json)
        except Exception:
            _fail("GAME_EVIDENCE_MALFORMED")
        evaluation = _normalize_game_result(quest, enrollment, game, game_id)
        index = int(self.claim_counts.get(quest_id, 0))
        claim_id = self._next_claim_id(quest_id, index)
        evidence_hash = hashlib.sha256(_canonical(game).encode("utf-8")).hexdigest()
        claim = {
            "id": claim_id,
            "quest_id": quest_id,
            "game_id": game_id,
            "claimant": wallet,
            "lichess_id": enrollment["lichess_id"],
            "submitted_at_ms": now_ms,
            "participant_policy": quest.get("participant_policy", "HUMAN_ONLY"),
            "source_policy_version": SOURCE_POLICY_VERSION,
            "rule_hash": quest["activation_hash"],
            "outcome": evaluation["outcome"],
            "reason_codes": evaluation["reason_codes"],
            "checks": evaluation["checks"],
            "evidence": game,
            "evidence_hash": evidence_hash,
            "reward_demo_units": 0,
        }
        self.claims[claim_id] = _canonical(claim)
        self.claim_counts[quest_id] = index + 1
        self.last_attempt_ms[enrollment_key] = now_ms
        self.latest_game_attempt[latest_key] = evaluation["outcome"]

        if evaluation["outcome"] == "VERIFIED":
            sponsor = quest["sponsor"]
            reward = int(quest["reward"])
            reserved = int(self.reserved_by_sponsor.get(sponsor, 0))
            _need(reserved >= reward and self.total_reserved >= reward, "ACCOUNTING_INVARIANT_FAILED")
            self.reserved_by_sponsor[sponsor] = reserved - reward
            self.total_reserved -= reward
            self.awarded_balances[wallet] = int(self.awarded_balances.get(wallet, 0)) + reward
            self.total_awarded += reward
            quest["state"] = "AWARDED"
            quest["winner"] = wallet
            quest["winning_claim_id"] = claim_id
            quest["awarded_at_ms"] = now_ms
            claim["reward_demo_units"] = reward
            claim["settled_at_ms"] = now_ms
            self.claims[claim_id] = _canonical(claim)

        self._save_quest(quest_id, quest)
        return claim

    @gl.public.view
    def get_claim(self, claim_id: str) -> dict:
        raw = self.claims.get(claim_id, "")
        if not raw:
            _fail("UNKNOWN_CLAIM")
        return json.loads(raw)

    @gl.public.view
    def list_claims(self, quest_id: str, offset: int, limit: int) -> list:
        _need(_is_int(offset) and offset >= 0, "INVALID_OFFSET")
        _need(_is_int(limit) and 1 <= limit <= 50, "INVALID_LIMIT")
        count = int(self.claim_counts.get(quest_id, 0))
        end = min(count, offset + limit)
        result = []
        index = offset
        while index < end:
            claim_id = self._next_claim_id(quest_id, index)
            raw = self.claims.get(claim_id, "")
            if raw:
                result.append(json.loads(raw))
            index += 1
        return result

    @gl.public.write
    def expire_quest(self, quest_id: str) -> int:
        quest = self._quest(quest_id)
        _need(quest["state"] == "ACTIVE", "QUEST_NOT_ACTIVE")
        _need(_now_ms() > quest["claim_deadline_ms"], "CLAIM_GRACE_STILL_OPEN")
        sponsor = quest["sponsor"]
        reward = int(quest["reward"])
        reserved = int(self.reserved_by_sponsor.get(sponsor, 0))
        _need(reserved >= reward and self.total_reserved >= reward, "ACCOUNTING_INVARIANT_FAILED")
        self.reserved_by_sponsor[sponsor] = reserved - reward
        self.total_reserved -= reward
        self.balances[sponsor] = int(self.balances.get(sponsor, 0)) + reward
        self.total_available += reward
        self.total_refunded += reward
        quest["state"] = "EXPIRED_REFUNDED"
        quest["refunded_at_ms"] = _now_ms()
        self._save_quest(quest_id, quest)
        return reward
