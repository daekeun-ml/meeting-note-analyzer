import numpy as np
import pytest
import soundfile as sf

pytest.importorskip("torch")

from stt.diarizer import load_waveform


def test_load_waveform_shape_and_rate(tmp_path):
    wav = tmp_path / "a.wav"
    sf.write(str(wav), np.zeros(16000, dtype=np.float32), 16000, subtype="PCM_16")
    d = load_waveform(wav)
    assert d["sample_rate"] == 16000
    assert tuple(d["waveform"].shape) == (1, 16000)
    assert str(d["waveform"].dtype) == "torch.float32"
