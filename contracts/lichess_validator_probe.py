# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Isolated Studionet probe for independent Lichess web retrieval.

This contract records public API fields only. It has no quests, balances, or rewards.
"""

import json

from genlayer import *


GAME_ID = "q7ZvsdUF"  # Lichess's published completed-game API example.
PROFILE_ID = "thibault"  # Public profile with a bio field at preflight time.


def _canonical(value: dict) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _game_fields() -> str:
    response = gl.nondet.web.get(
        "https://lichess.org/game/export/"
        + GAME_ID
        + "?moves=true&tags=true&clocks=false&evals=false&opening=false",
        headers={"Accept": "application/json", "User-Agent": "Clutch/0.1"},
    )
    if response.status != 200 or response.body is None:
        return _canonical({"fetch_status": "HTTP_ERROR", "http_status": response.status})
    try:
        game = json.loads(response.body.decode("utf-8"))
    except Exception:
        return _canonical({"fetch_status": "INVALID_JSON"})
    if not isinstance(game, dict):
        return _canonical({"fetch_status": "INVALID_JSON"})

    players = game.get("players")
    if not isinstance(players, dict):
        players = {}
    white = players.get("white")
    black = players.get("black")
    white_user = white.get("user") if isinstance(white, dict) else None
    black_user = black.get("user") if isinstance(black, dict) else None
    moves = game.get("moves")
    return _canonical(
        {
            "fetch_status": "OK",
            "id": game.get("id"),
            "rated": game.get("rated"),
            "variant": game.get("variant"),
            "speed": game.get("speed"),
            "status": game.get("status"),
            "source": game.get("source"),
            "created_at_ms": game.get("createdAt"),
            "last_move_at_ms": game.get("lastMoveAt"),
            "white_id": white_user.get("id") if isinstance(white_user, dict) else None,
            "black_id": black_user.get("id") if isinstance(black_user, dict) else None,
            "plies": len(moves.split()) if isinstance(moves, str) else None,
        }
    )


def _profile_fields() -> str:
    response = gl.nondet.web.get(
        "https://lichess.org/api/user/" + PROFILE_ID + "?profile=true",
        headers={"Accept": "application/json", "User-Agent": "Clutch/0.1"},
    )
    if response.status != 200 or response.body is None:
        return _canonical({"fetch_status": "HTTP_ERROR", "http_status": response.status})
    try:
        account = json.loads(response.body.decode("utf-8"))
    except Exception:
        return _canonical({"fetch_status": "INVALID_JSON"})
    if not isinstance(account, dict):
        return _canonical({"fetch_status": "INVALID_JSON"})
    profile = account.get("profile")
    bio = profile.get("bio") if isinstance(profile, dict) else None
    return _canonical(
        {
            "fetch_status": "OK",
            "id": account.get("id"),
            "bio_is_string": isinstance(bio, str),
        }
    )


class LichessValidatorProbe(gl.Contract):
    owner: Address
    game_json: str
    profile_json: str

    def __init__(self):
        self.owner = gl.message.sender_address
        self.game_json = ""
        self.profile_json = ""

    def _only_owner(self) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("PROBE|ONLY_OWNER")

    @gl.public.view
    def get_probe_info(self) -> dict:
        return {
            "version": "clutch-lichess-validator-probe/1",
            "runner": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6",
            "chain_id": int(gl.message.chain_id),
            "game_id": GAME_ID,
            "profile_id": PROFILE_ID,
        }

    @gl.public.view
    def get_results(self) -> dict:
        return {
            "game": json.loads(self.game_json) if self.game_json else None,
            "profile": json.loads(self.profile_json) if self.profile_json else None,
        }

    @gl.public.write
    def probe_game(self) -> None:
        self._only_owner()
        agreed = gl.eq_principle.strict_eq(_game_fields)
        record = json.loads(agreed)
        if (
            record.get("fetch_status") != "OK"
            or record.get("id") != GAME_ID
            or record.get("rated") is not True
            or record.get("variant") != "standard"
            or record.get("status") != "draw"
            or not isinstance(record.get("white_id"), str)
            or not isinstance(record.get("black_id"), str)
            or not isinstance(record.get("plies"), int)
            or record["plies"] < 1
        ):
            raise gl.vm.UserError("PROBE|GAME_FIELDS_MISSING")
        self.game_json = agreed

    @gl.public.write
    def probe_profile(self) -> None:
        self._only_owner()
        agreed = gl.eq_principle.strict_eq(_profile_fields)
        record = json.loads(agreed)
        if record.get("fetch_status") != "OK" or record.get("id") != PROFILE_ID or record.get("bio_is_string") is not True:
            raise gl.vm.UserError("PROBE|PROFILE_BIO_UNAVAILABLE")
        self.profile_json = agreed
