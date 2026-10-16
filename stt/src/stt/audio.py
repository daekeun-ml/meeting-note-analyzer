"""Audio normalization via ffmpeg (mp3 -> 16 kHz mono wav) and duration probing."""
from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return float(json.loads(out)["format"]["duration"])


def to_wav16k(src: Path, dst: Path) -> Path:
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dst)],
        check=True,
    )
    return dst


def run_media(command: list[str], timeout=600) -> bytes:
    """Do not expose signed source URLs through subprocess error messages."""
    try:
        result = subprocess.run(command, check=False, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError("Media processing timed out") from None
    if result.returncode:
        raise RuntimeError("Media processing failed")
    return result.stdout


def estimate_noise_floor(source: Path) -> float:
    """Sample quiet, spectrally flat frames across the recording without loading it all."""
    import numpy as np
    import soundfile as sf

    levels = []
    with sf.SoundFile(source) as stream:
        rate = stream.samplerate
        frame_size = max(256, rate // 4)
        window = np.hanning(frame_size)
        frequencies = np.fft.rfftfreq(frame_size, 1 / rate)
        band = (frequencies >= 80) & (frequencies <= min(7600, rate / 2))
        count = min(64, max(1, math.ceil(len(stream) / rate)))
        for position in np.linspace(0, max(0, len(stream) - rate), count, dtype=int):
            stream.seek(int(position))
            samples = stream.read(rate, dtype="float32", always_2d=True).mean(axis=1)
            for start in range(0, len(samples) - frame_size + 1, frame_size):
                power = abs(np.fft.rfft(samples[start:start + frame_size] * window)) ** 2
                spectrum = power[band]
                mean_power = float(spectrum.mean())
                if mean_power <= 1e-16:
                    continue
                flatness = float(np.exp(np.log(np.maximum(spectrum, 1e-20)).mean()) / mean_power)
                # MP3 quantization creates spectral holes even in stationary white noise
                # (typically ~0.35 flatness after decoding, versus ~0.55 in PCM).
                # Voiced speech remains strongly peaked; the lower level percentile
                # and the 6 dB reduction cap further limit speech attenuation.
                if flatness >= .30:
                    rms = math.sqrt(2 * float(spectrum.sum()) / (frame_size * float((window ** 2).sum())))
                    levels.append(20 * math.log10(max(rms, 1e-10)))
    return max(-80.0, min(-25.0, float(np.percentile(levels, 20)))) if len(levels) >= 3 else -80.0


def denoise_wav(source: Path, destination: Path, noise_floor_db: float | None = None) -> Path:
    """Mild spectral subtraction, without VAD/silence removal or timeline shifts."""
    floor = estimate_noise_floor(source) if noise_floor_db is None else noise_floor_db
    run_media(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(source), "-af",
               f"highpass=f=70,afftdn=nr=6:nf={floor:.2f}:nt=w:tn=0:gs=8",
               "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(destination)])
    # A filter failure or truncated output must never silently shorten the recording.
    if abs(probe_duration(source) - probe_duration(destination)) > 0.05:
        raise RuntimeError("Noise reduction changed the recording duration")
    return destination


def export_mp3(source: Path, destination: Path, start: float, end: float):
    run_media(["ffmpeg", "-nostdin", "-y", "-v", "error", "-ss", str(start), "-i", str(source),
               "-t", str(end - start), "-map", "0:a:0", "-c:a", "libmp3lame", "-b:a", "128k",
               "-metadata", f"comment=Original recording start: {start:.3f} seconds", str(destination)])


def video_start(source: str, requested: float) -> float:
    """Expand to an earlier keyframe so stream-copy never loses the first retained speech."""
    if requested <= 0:
        return 0.0
    result = run_media(["ffprobe", "-v", "error", "-rw_timeout", "30000000",
        "-read_intervals", f"{max(0, requested - 30)}%{requested + 1}", "-skip_frame", "nokey",
        "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time",
        "-of", "json", source], timeout=90)
    times = [float(frame["best_effort_timestamp_time"]) for frame in json.loads(result).get("frames", [])
             if "best_effort_timestamp_time" in frame]
    preceding = [t for t in times if math.isfinite(t) and 0 <= t <= requested]
    if not preceding:
        return 0.0  # Retain more context; never skip forward into substantive speech.
    return max(preceding)


def export_video(source: str, audio: Path, destination: Path, start: float, end: float) -> float:
    actual_start = video_start(source, start)
    run_media(["ffmpeg", "-nostdin", "-y", "-v", "error", "-rw_timeout", "30000000",
        "-ss", str(actual_start), "-i", source, "-ss", str(actual_start), "-i", str(audio),
        "-t", str(end - actual_start), "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        "-metadata", f"comment=Original recording start: {actual_start:.3f} seconds", str(destination)],
        timeout=1200)
    return actual_start
