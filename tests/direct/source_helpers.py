"""Load the contract's pure rule functions without importing GenVM modules."""

import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "contracts" / "clutch.py"
PURE_FUNCTIONS = {"_is_int", "_record_check", "_valid_compilation", "_normalize_compilation_shape", "_normalize_game_result"}
PURE_CONSTANTS = {
    "ALLOWED_REASON_CODES",
    "ALLOWED_SOURCES",
    "ALLOWED_WIN_STATUSES",
    "ALLOWED_DRAW_STATUSES",
    "STANDARD_FEN",
    "MAX_PLY_LIMIT",
}


tree = ast.parse(CONTRACT.read_text(encoding="utf-8"), filename=str(CONTRACT))
body = []
for node in tree.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in PURE_FUNCTIONS:
        body.append(node)
    elif isinstance(node, ast.Assign) and any(
        isinstance(target, ast.Name) and target.id in PURE_CONSTANTS
        for target in node.targets
    ):
        body.append(node)

module = ast.fix_missing_locations(ast.Module(body=body, type_ignores=[]))
namespace = {}
exec(compile(module, str(CONTRACT), "exec"), namespace)

_normalize_game_result = namespace["_normalize_game_result"]
_valid_compilation = namespace["_valid_compilation"]
_normalize_compilation_shape = namespace["_normalize_compilation_shape"]
