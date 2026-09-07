"""pyannote speaker diarization wrapper (community-1 pipeline loaded offline from the model dir)."""
from __future__ import annotations

from pathlib import Path

from .align import Turn


def load_waveform(wav: Path) -> dict:
    """Return pyannote's in-memory audio dict {waveform: (channel, time) float32 tensor, sample_rate}."""
    import soundfile as sf  # lazy
    import torch  # lazy

    data, sample_rate = sf.read(str(wav), dtype="float32", always_2d=True)  # (time, channel)
    return {"waveform": torch.from_numpy(data.T.copy()), "sample_rate": int(sample_rate)}


class Diarizer:
    def __init__(self, pipeline_dir: str | Path, device: str = "cuda"):
        import torch  # lazy
        from pyannote.audio import Pipeline  # lazy

        cfg = Path(pipeline_dir)
        if cfg.is_dir():
            cfg = cfg / "config.yaml"
        self.pipeline = Pipeline.from_pretrained(str(cfg))
        if device == "cuda" and torch.cuda.is_available():
            self.pipeline.to(torch.device("cuda"))

    def diarize(self, wav: Path, *, min_speakers: int | None = None, max_speakers: int | None = None) -> list[Turn]:
        kwargs: dict = {}
        if min_speakers:
            kwargs["min_speakers"] = min_speakers
        if max_speakers:
            kwargs["max_speakers"] = max_speakers
        # Feed the waveform directly: pyannote 4's file loader needs torchcodec, whose FFmpeg bindings do not load in
        # this container. The wav is already 16 kHz mono PCM from ffmpeg, so libsndfile is all we need.
        output = self.pipeline(load_waveform(wav), **kwargs)
        annotation = getattr(output, "speaker_diarization", output)  # pyannote 4 returns an object, 3 an Annotation
        turns: list[Turn] = []
        for segment, _track, label in annotation.itertracks(yield_label=True):
            turns.append(Turn(float(segment.start), float(segment.end), str(label)))
        return turns
