import json
from datetime import datetime, timezone

import pytest

from .conftest import as_wallet, set_tx_time


BASE_TIME = "2026-09-28T12:00:00Z"
RULES = {
    "platform": "LICHESS", "variant": "STANDARD", "rated": "REQUIRED",
    "speed": "BLITZ", "player_color": "BLACK", "result": "WIN", "max_plies": 80,
}


def future_window(offset_hours=2):
    base = datetime.fromisoformat(BASE_TIME.replace("Z", "+00:00"))
    start = int((base.replace(tzinfo=timezone.utc).timestamp() + offset_hours * 3600) * 1000)
    return start, start + 4 * 60 * 60 * 1000


def create_compiled_quest(clutch, direct_vm, direct_alice, reward=25):
    start, end = future_window()
    direct_vm.sender = direct_alice
    clutch.claim_starter_allocation()
    quest_id = clutch.create_draft("Win a rated blitz game as Black in no more than 40 full moves.", reward, start, end)
    direct_vm.mock_llm(
        r".*Compile the sponsor's chess-quest description.*",
        json.dumps({"status": "COMPILED", "rules": RULES, "reason_codes": []}),
    )
    compiled = clutch.compile_draft(quest_id)
    assert compiled["status"] == "COMPILED"
    return quest_id, compiled, start, end


def test_sponsor_confirms_exact_hash_and_reserves_conserved_units(clutch, direct_vm, direct_alice, direct_bob):
    quest_id, compiled, start, _ = create_compiled_quest(clutch, direct_vm, direct_alice)
    assert len(compiled["rule_hash"]) == 64

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("ONLY_SPONSOR"):
        clutch.confirm_and_activate(quest_id, compiled["rule_hash"])

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("CONFIRMATION_HASH_MISMATCH"):
        clutch.confirm_and_activate(quest_id, "0" * 64)
    assert clutch.get_account(as_wallet(direct_alice))["sponsor_available"] == 100

    assert clutch.confirm_and_activate(quest_id, compiled["rule_hash"])
    quest = clutch.get_quest(quest_id)
    account = clutch.get_account(as_wallet(direct_alice))
    assert quest["state"] == "ACTIVE"
    assert quest["activation_hash"] == compiled["rule_hash"]
    assert account["sponsor_available"] == 75
    assert account["total_available"] == 75
    assert account["total_reserved"] == 25
    assert account["total_available"] + account["total_reserved"] + account["total_awarded"] == account["total_issued"]
    assert start == quest["starts_at_ms"]


def test_any_draft_edit_invalidates_previous_compilation_and_confirmation(clutch, direct_vm, direct_alice):
    quest_id, compiled, _, _ = create_compiled_quest(clutch, direct_vm, direct_alice)
    start, end = future_window(offset_hours=3)
    assert clutch.update_draft(quest_id, "Draw a rapid game.", 30, start, end)
    quest = clutch.get_quest(quest_id)
    assert quest["state"] == "DRAFT"
    assert quest["compile_status"] == ""
    assert quest["rules"] is None
    assert quest["rule_hash"] == ""
    with direct_vm.expect_revert("COMPILED_QUEST_REQUIRED"):
        clutch.confirm_and_activate(quest_id, compiled["rule_hash"])


def test_activation_race_can_only_refund_after_claim_grace(clutch, direct_vm, direct_alice):
    quest_id, compiled, _, end = create_compiled_quest(clutch, direct_vm, direct_alice, reward=17)
    assert clutch.confirm_and_activate(quest_id, compiled["rule_hash"])

    set_tx_time(direct_vm, datetime.fromtimestamp((end + 7 * 24 * 60 * 60 * 1000) / 1000, timezone.utc).isoformat())
    with direct_vm.expect_revert("CLAIM_GRACE_STILL_OPEN"):
        clutch.expire_quest(quest_id)

    set_tx_time(direct_vm, datetime.fromtimestamp((end + 7 * 24 * 60 * 60 * 1000 + 1) / 1000, timezone.utc).isoformat())
    assert clutch.expire_quest(quest_id) == 17
    with direct_vm.expect_revert("QUEST_NOT_ACTIVE"):
        clutch.expire_quest(quest_id)
    account = clutch.get_account(as_wallet(direct_alice))
    assert account["sponsor_available"] == 100
    assert account["total_available"] == account["total_issued"]
    assert account["total_reserved"] == 0
    assert account["total_awarded"] == 0
    assert account["total_refunded"] == 17


def test_account_challenge_is_wallet_bound_expires_and_can_be_superseded(clutch, direct_vm, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    first = clutch.request_link_challenge("PuzzlePilot")
    assert first["wallet"] == as_wallet(direct_alice)
    assert clutch.get_active_link_challenge(as_wallet(direct_alice))["nonce"] == first["nonce"]

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("ONLY_REQUESTING_WALLET"):
        clutch.verify_link_challenge(first["nonce"])

    direct_vm.sender = direct_alice
    second = clutch.request_link_challenge("PuzzlePilot")
    assert second["nonce"] != first["nonce"]
    with direct_vm.expect_revert("CHALLENGE_NOT_ACTIVE"):
        clutch.verify_link_challenge(first["nonce"])

    set_tx_time(direct_vm, "2026-09-28T12:31:00Z")
    with direct_vm.expect_revert("CHALLENGE_EXPIRED"):
        clutch.verify_link_challenge(second["nonce"])


def test_verified_profile_binding_is_unique_and_immutable(clutch, direct_vm, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    challenge = clutch.request_link_challenge("PuzzlePilot")
    direct_vm.mock_web(
        r".*lichess\.org/api/user/puzzlepilot\?profile=true.*",
        {"status": 200, "body": json.dumps({"id": "puzzlepilot", "profile": {"bio": "hello " + challenge["text"]}}).encode("utf-8")},
    )
    linked = clutch.verify_link_challenge(challenge["nonce"])
    assert linked["verified"] is True
    assert clutch.get_my_link()["lichess_id"] == "puzzlepilot"
    assert clutch.get_link_for_wallet(as_wallet(direct_alice))["lichess_id"] == "puzzlepilot"

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("LICHESS_ACCOUNT_ALREADY_LINKED"):
        clutch.request_link_challenge("puzzlepilot")

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("WALLET_ALREADY_LINKED"):
        clutch.request_link_challenge("differentpilot")
