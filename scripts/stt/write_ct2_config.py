"""Write a CTranslate2-format config.json into a converted CrisperWhisper directory.

CTranslate2's Whisper model reads lang_ids / suppress_ids / suppress_ids_begin from config.json (its own format).
The crisperwhisper converter leaves the HuggingFace config there instead, so detect_language() has no language
token list and returns nothing. This derives the CT2 config from tokenizer.json and generation_config.json.

Usage: python write_ct2_config.py <ct2_dir>
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

LANG_RE = re.compile(r"^<\|([a-z]{2,3})\|>$")


def build_config(ct2_dir: Path) -> dict:
    tok = json.loads((ct2_dir / "tokenizer.json").read_text(encoding="utf-8"))
    vocab: dict[str, int] = dict(tok.get("model", {}).get("vocab", {}))
    for added in tok.get("added_tokens", []):
        vocab[added["content"]] = added["id"]
    lang_ids = sorted(tid for token, tid in vocab.items() if LANG_RE.match(token))
    gen_path = ct2_dir / "generation_config.json"
    gen = json.loads(gen_path.read_text(encoding="utf-8")) if gen_path.exists() else {}
    suppress = [int(t) for t in gen.get("suppress_tokens", []) if isinstance(t, int) and t >= 0]
    begin = [int(t) for t in gen.get("begin_suppress_tokens", []) if isinstance(t, int) and t >= 0]
    cfg: dict = {"lang_ids": lang_ids, "suppress_ids": suppress, "suppress_ids_begin": begin}
    heads = gen.get("alignment_heads")
    if isinstance(heads, list) and heads:
        cfg["alignment_heads"] = heads
    return cfg


if __name__ == "__main__":
    d = Path(sys.argv[1])
    cfg = build_config(d)
    backup = d / "config.hf.json"
    if (d / "config.json").exists() and not backup.exists():
        (d / "config.json").rename(backup)
    (d / "config.json").write_text(json.dumps(cfg), encoding="utf-8")
    print(f"wrote CT2 config: {len(cfg['lang_ids'])} lang_ids, {len(cfg['suppress_ids'])} suppress_ids, {len(cfg['suppress_ids_begin'])} begin_suppress, alignment_heads={'yes' if 'alignment_heads' in cfg else 'no'}")
