"""Load one selected ASR/diarizer pair at a time under the server's inference lock."""
import gc
import json
import logging
from pathlib import Path

from .model_catalog import CATALOG_VERSION, DEFAULT_MODELS, MODELS, SpeechModels

log = logging.getLogger(__name__)


class ModelRegistry:
    def __init__(self, root: Path, device="cuda"):
        self.root, self.device = root, device
        self.selection = self.transcriber = self.diarizer = None
        manifest = json.loads((root / "bundle-manifest.json").read_text())
        if manifest.get("version") != CATALOG_VERSION or manifest.get("models") != MODELS:
            raise ValueError("The deployed speech model bundle does not match the runtime catalog")
        required = [root / spec["directory"] / filename for spec in MODELS.values() for filename in ("config.json", "model.safetensors")]
        required.extend([root / "crisperwhisper/ct2/model.bin", root / "pyannote/community-1/config.yaml"])
        if any(not path.is_file() or not path.stat().st_size for path in required):
            raise ValueError("The speech model bundle is incomplete")
        self.manifest = manifest

    def activate(self, selection: SpeechModels):
        if selection == self.selection:
            return self.transcriber, self.diarizer
        self.transcriber = self.diarizer = self.selection = None
        gc.collect()
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        if selection.stt == "crisperwhisper":
            from .transcriber import Transcriber
            transcriber = Transcriber(self.root / "crisperwhisper/ct2", backend="ct2", device=self.device)
        else:
            from .hf_transcriber import ForcedAligner, HfTranscriber
            aligner = ForcedAligner(self.root / MODELS["qwen3-aligner"]["directory"], self.device)
            transcriber = HfTranscriber(selection.stt, self.root / MODELS[selection.stt]["directory"], aligner, self.device)
        if selection.diarization == "nemotron3":
            from .nemotron import NemotronDiarizer
            diarizer = NemotronDiarizer(self.root / MODELS["nemotron3"]["directory"], self.device)
        elif selection.diarization == "community1":
            from .diarizer import Diarizer
            diarizer = Diarizer(self.root / "pyannote/community-1", self.device)
        else:
            diarizer = None
        self.transcriber, self.diarizer, self.selection = transcriber, diarizer, selection.model_copy()
        log.info("Speech model selection ready: %s", json.dumps(selection.model_dump()))
        return transcriber, diarizer

    def warmup(self):
        self.activate(DEFAULT_MODELS)

    def provenance(self):
        result = {key: value["revision"] for key, value in MODELS.items()
                  if key in (self.selection.stt, self.selection.diarization) or
                  (key == "qwen3-aligner" and self.selection.stt != "crisperwhisper")}
        if self.selection.stt == "crisperwhisper" or self.selection.diarization == "community1":
            result["legacyArtifact"] = self.manifest.get("legacyArtifactRevision", "existing")
        return result
