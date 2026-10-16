import hashlib
import json
import shutil
import subprocess

import numpy as np
import pytest
import soundfile as sf

from stt.audio import denoise_wav, export_mp3, export_video, probe_duration

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="ffmpeg and ffprobe required")


def test_fft_reduces_stationary_noise_without_shortening_or_overwriting_audio(tmp_path):
    rate = 16000
    t = np.arange(rate * 6) / rate
    speech = .22 * np.sin(2 * np.pi * 220 * t) + .08 * np.sin(2 * np.pi * 660 * t)
    speech[(t < 1) | (t > 5)] = 0
    noise = np.random.default_rng(42).normal(0, .035, t.shape)
    source, target = tmp_path / "original.wav", tmp_path / "filtered.wav"
    sf.write(source, speech + noise, rate, subtype="PCM_16")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    denoise_wav(source, target)
    filtered, actual_rate = sf.read(target)
    assert actual_rate == rate and len(filtered) == len(t)
    quiet = (t > 5.25) & (t < 5.75)
    assert np.sqrt(np.mean(filtered[quiet] ** 2)) < np.sqrt(np.mean(noise[quiet] ** 2)) * .8
    speaking = (t > 2) & (t < 4)
    assert np.sqrt(np.mean(filtered[speaking] ** 2)) > np.sqrt(np.mean(speech[speaking] ** 2)) * .7
    assert hashlib.sha256(source.read_bytes()).hexdigest() == digest
    export_mp3(target, tmp_path / "processed.mp3", 1.25, 4.25)
    assert abs(probe_duration(tmp_path / "processed.mp3") - 3) < .2


def test_mp4_keeps_video_codec_and_aligns_the_processed_audio_to_an_earlier_keyframe(tmp_path):
    video, audio, output = tmp_path / "original.mp4", tmp_path / "audio.wav", tmp_path / "processed.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=25:duration=10",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=10",
        "-c:v", "libx264", "-g", "25", "-keyint_min", "25", "-sc_threshold", "0", "-c:a", "aac", str(video)], check=True)
    rate = 16000
    sf.write(audio, .2 * np.sin(2 * np.pi * 660 * np.arange(rate * 10) / rate), rate)
    original = hashlib.sha256(video.read_bytes()).hexdigest()
    start = export_video(str(video), audio, output, 2.4, 8.4)
    assert 1.9 <= start <= 2.4
    info = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(output)]))
    assert [s["codec_name"] for s in info["streams"]] == ["h264", "aac"]
    assert abs(float(info["format"]["duration"]) - (8.4 - start)) < .25
    assert all(abs(float(s.get("start_time", 0))) < .15 for s in info["streams"])
    assert "Original recording start" in info["format"]["tags"]["comment"]
    assert hashlib.sha256(video.read_bytes()).hexdigest() == original
