"""Prepare the STT model prefix that the SageMaker endpoint mounts at /opt/ml/model.

Layout produced under <out>/:
  crisperwhisper/ct2/        CTranslate2-converted CrisperWhisper 2.0 (model.bin + tokenizer/config files)
  pyannote/community-1/      snapshot of pyannote/speaker-diarization-community-1 (config.yaml + weights)
  hf-cache/hub/              HuggingFace cache with the pyannote repos, for offline loading by repo id
  qwen3_asr/, qwen3_aligner/ pinned Qwen transcription and word-alignment snapshots
  ark_asr/, nemotron3/      pinned alternative ASR and default diarization snapshots
"""
from __future__ import annotations

import os
import json
import shutil
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

VARIANT = sys.argv[1] if len(sys.argv) > 1 else "large"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/models")
TOKEN = os.environ.get("HF_TOKEN") or None
CW_REPO = f"nyralabs/CrisperWhisper2.0_{VARIANT}"
PYANNOTE_REPOS = [
    "pyannote/speaker-diarization-community-1",
    "pyannote/segmentation-3.0",
    "pyannote/wespeaker-voxceleb-resnet34-LM",
]
TOKENIZER_FILES = [
    "config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json",
    "added_tokens.json", "special_tokens_map.json", "normalizer.json", "merges.txt", "vocab.json",
]


def log(msg: str) -> None:
    print(f"[publish] {msg}", flush=True)


def convert_crisperwhisper() -> None:
    hf_dir = OUT / "crisperwhisper" / "hf"
    ct2_dir = OUT / "crisperwhisper" / "ct2"
    cache = OUT / "crisperwhisper" / "_cache"
    log(f"downloading {CW_REPO}")
    snapshot_download(CW_REPO, token=TOKEN, local_dir=str(hf_dir))
    log("converting to CTranslate2 (float16 storage)")
    from crisperwhisper.converter import ensure_ct2_model  # type: ignore[attr-defined]

    converted = Path(ensure_ct2_model(str(hf_dir), quantization="float16", cache_dir=str(cache)))
    if ct2_dir.exists():
        shutil.rmtree(ct2_dir)
    shutil.copytree(converted, ct2_dir)
    for name in TOKENIZER_FILES:
        src = hf_dir / name
        if src.exists() and not (ct2_dir / name).exists():
            shutil.copy2(src, ct2_dir / name)
    assert (ct2_dir / "model.bin").exists(), "model.bin missing after conversion"
    import subprocess

    subprocess.run([sys.executable, str(Path(__file__).with_name("write_ct2_config.py")), str(ct2_dir)], check=True)
    (ct2_dir / "config.hf.json").unlink(missing_ok=True)
    for zero in [p for p in ct2_dir.iterdir() if p.is_file() and p.stat().st_size == 0]:
        zero.unlink()  # SageMaker uncompressed prefixes must not contain empty objects
    shutil.rmtree(hf_dir, ignore_errors=True)
    shutil.rmtree(cache, ignore_errors=True)
    log(f"ct2 ready: {sorted(p.name for p in ct2_dir.iterdir())}")


def fetch_pyannote() -> None:
    hub_cache = OUT / "hf-cache" / "hub"
    hub_cache.mkdir(parents=True, exist_ok=True)
    for repo in PYANNOTE_REPOS:
        try:
            log(f"downloading {repo} into cache")
            snapshot_download(repo, token=TOKEN, cache_dir=str(hub_cache))
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"Could not download required diarization model {repo}; check token access and model conditions") from exc
    target = OUT / "pyannote" / "community-1"
    if target.exists():
        shutil.rmtree(target)
    try:
        snapshot_download(PYANNOTE_REPOS[0], token=TOKEN, local_dir=str(target))
        shutil.rmtree(target / ".cache", ignore_errors=True)
        if not (target / "config.yaml").exists():
            raise FileNotFoundError("config.yaml missing from pyannote snapshot")
        log(f"pyannote ready: {sorted(p.name for p in target.iterdir())}")
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(target, ignore_errors=True)  # never leave a partial pipeline dir in the model prefix
        raise RuntimeError("The diarization pipeline is incomplete; check Hugging Face model access") from exc
    # strip huggingface download scratch (lock files) from the cache too
    for junk in hub_cache.rglob("*.lock"):
        junk.unlink(missing_ok=True)


def reuse_legacy() -> bool:
    """Keep the already deployed legacy weights when adding selectable models."""
    bucket, prefix = os.environ.get("DATA_BUCKET"), os.environ.get("LEGACY_MODEL_PREFIX")
    if not bucket or not prefix:
        return False
    import boto3
    from botocore.exceptions import ClientError
    client = boto3.client("s3")
    try:
        client.head_object(Bucket=bucket, Key=prefix + "crisperwhisper/ct2/model.bin")
        client.head_object(Bucket=bucket, Key=prefix + "pyannote/community-1/config.yaml")
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return False
        raise
    log("reusing deployed CrisperWhisper and Community-1 weights")
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            relative = item["Key"][len(prefix):]
            if not relative.startswith(("crisperwhisper/", "pyannote/", "hf-cache/")) or not item["Size"]:
                continue
            destination = OUT / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            client.download_file(bucket, item["Key"], str(destination))
    return True


def fetch_speech_choices():
    raw = os.environ.get("SPEECH_MODEL_CATALOG")
    if not raw:
        return
    catalog = json.loads(raw)
    for spec in catalog["models"].values():
        log(f"downloading pinned {spec['repository']} at {spec['revision']}")
        target = OUT / spec["directory"]
        snapshot_download(spec["repository"], revision=spec["revision"], token=TOKEN, local_dir=str(target),
                          allow_patterns=["*.json", "*.safetensors", "*.py", "*.model", "*.txt", "*.jinja", "*.md"])
        shutil.rmtree(target / ".cache", ignore_errors=True)
        if not (target / "config.json").is_file() or not list(target.glob("*.safetensors")):
            raise ValueError("Incomplete speech model snapshot")
    (OUT / "bundle-manifest.json").write_text(json.dumps({
        **catalog, "legacyArtifactRevision": os.environ.get("LEGACY_MODEL_REVISION", "converted"),
    }, indent=2))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    if not reuse_legacy():
        convert_crisperwhisper()
        fetch_pyannote()
    fetch_speech_choices()
    for empty in (path for path in OUT.rglob("*") if path.is_file() and path.stat().st_size == 0):
        empty.unlink()
    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file()) / 1e9
    log(f"done, {total:.2f} GB under {OUT}")
