"""Bounded, speech-protecting spectral denoising with a measured noise profile."""
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

RATE, FFT_SIZE, HOP = 16000, 512, 128
MAX_REDUCTION_DB = 10.0
PROFILE_FRAME = 4096
WINDOW = np.hanning(FFT_SIZE)


@dataclass
class NoiseProfile:
    power: np.ndarray
    positions: list[int]
    floor_db: float


def estimate_noise_profile(source: Path) -> NoiseProfile | None:
    """Find sustained quiet, non-periodic frames across at most 256 seconds.

    Local spectral whitening tests texture rather than assuming white noise.
    Periodicity, low-energy selection and adjacent-frame requirements reduce
    the risk of learning vowels or short unvoiced consonants as background.
    """
    frames = []
    with sf.SoundFile(source) as stream:
        if stream.samplerate != RATE or stream.channels != 1:
            raise ValueError("Noise reduction requires 16 kHz mono audio")
        count = min(128, len(stream) // (2 * RATE))
        if count < 2:
            return None
        window = np.hanning(PROFILE_FRAME)
        frequency = np.fft.rfftfreq(PROFILE_FRAME, 1 / RATE)
        band = (frequency >= 300) & (frequency <= 3400)
        for group, position in enumerate(np.linspace(0, len(stream) - 2 * RATE, count, dtype=int)):
            stream.seek(int(position))
            samples = stream.read(2 * RATE, dtype="float32")
            for offset in range(0, len(samples) - PROFILE_FRAME + 1, PROFILE_FRAME):
                audio = samples[offset:offset + PROFILE_FRAME].astype(np.float64)
                audio -= audio.mean()
                rms = float(np.sqrt(np.mean(audio ** 2)))
                level = 20 * np.log10(max(rms, 1e-12))
                power = abs(np.fft.rfft(audio * window)) ** 2
                spectrum = power[band]
                smooth = np.convolve(spectrum, np.ones(21) / 21, mode="same")
                ratio = spectrum / np.maximum(smooth, 1e-20)
                texture = ratio[10:-10]
                flatness = np.exp(np.log(np.maximum(texture, 1e-20)).mean()) / max(texture.mean(), 1e-20)
                correlation = np.fft.irfft(abs(np.fft.rfft(audio, PROFILE_FRAME * 2)) ** 2)
                periodicity = max(correlation[40:201]) / max(correlation[0], 1e-20)
                frames.append((group, int(position + offset), level, flatness, periodicity, audio))
    quiet_limit = float(np.percentile([frame[2] for frame in frames], 20))
    eligible = {i for i, frame in enumerate(frames)
                if -65 < frame[2] <= quiet_limit and frame[3] >= .35 and frame[4] < .45}
    selected = []
    for i in sorted(eligible):
        # At least half a second of compatible frames in the same sampled window.
        if any(j in eligible and frames[j][0] == frames[i][0] for j in (i - 1, i + 1)):
            selected.append(frames[i])
    if len(selected) < 4 or len({frame[0] for frame in selected}) < 2:
        return None
    powers = []
    for frame in selected:
        windows = np.lib.stride_tricks.sliding_window_view(frame[5], FFT_SIZE)[::FFT_SIZE // 2]
        powers.append(np.mean(abs(np.fft.rfft(windows * WINDOW, axis=1)) ** 2, axis=0))
    power = np.median(powers, axis=0)
    power = np.convolve(np.pad(power, (2, 2), mode="edge"), np.array([1, 2, 3, 2, 1]) / 9, mode="valid")
    return NoiseProfile(np.maximum(power, 1e-16), [frame[1] for frame in selected],
                        float(np.median([frame[2] for frame in selected])))


def _filter(source: Path, destination: Path, profile: NoiseProfile):
    """Streaming overlap-add keeps memory bounded and preserves every sample."""
    noise = profile.power
    minimum = 10 ** (-MAX_REDUCTION_DB / 20)
    voice_minimum = 10 ** (-3 / 20)
    frequency = np.fft.rfftfreq(FFT_SIZE, 1 / RATE)
    voice_band = (frequency >= 300) & (frequency <= 4000)
    previous_gain = np.ones(len(noise))
    smoothed_power = noise.copy()
    overlap, weight = np.zeros(FFT_SIZE), np.zeros(FFT_SIZE)
    pad = FFT_SIZE - HOP
    discarded, written = 0, 0
    with sf.SoundFile(source) as stream, sf.SoundFile(
            destination, "w", samplerate=RATE, channels=1, subtype="PCM_16") as output:
        total = len(stream)
        buffer = np.zeros(pad)
        finished = False
        while not finished:
            audio = stream.read(RATE * 2, dtype="float64")
            finished = len(audio) < RATE * 2
            buffer = np.concatenate((buffer, audio, np.zeros(FFT_SIZE) if finished else np.empty(0)))
            count = max(0, (len(buffer) - FFT_SIZE) // HOP + 1)
            windows = np.lib.stride_tricks.sliding_window_view(buffer, FFT_SIZE)[::HOP][:count]
            spectra = np.fft.rfft(windows * WINDOW, axis=1)
            blocks = []
            for spectrum in spectra:
                power = abs(spectrum) ** 2
                smoothed_power = .6 * smoothed_power + .4 * power
                prior = np.maximum(smoothed_power / noise - 1, 0)
                gain = prior / (1 + prior)
                # Even low-SNR possible speech gets a 3 dB floor. Strong bins
                # naturally approach unity; no speech-triggered volume gate.
                possible_speech = smoothed_power[voice_band].sum() > noise[voice_band].sum() * 1.8
                gain = np.maximum(gain, voice_minimum if possible_speech else minimum)
                smooth = np.convolve(np.pad(gain, (2, 2), mode="edge"), np.ones(5) / 5, mode="valid")
                gain = np.maximum(gain, smooth)  # Never smooth down a speech peak.
                speed = np.where(gain > previous_gain, .85, .15)
                gain = previous_gain + speed * (gain - previous_gain)
                if possible_speech:
                    gain = np.maximum(gain, voice_minimum)
                previous_gain = gain
                overlap += np.fft.irfft(spectrum * gain) * WINDOW
                weight += WINDOW ** 2
                block = overlap[:HOP] / np.maximum(weight[:HOP], 1e-20)
                if discarded < pad:
                    skip = min(HOP, pad - discarded)
                    discarded += skip
                    block = block[skip:]
                remaining = total - written
                block = block[:remaining]
                if len(block):
                    blocks.append(block.copy())
                    written += len(block)
                overlap[:-HOP], overlap[-HOP:] = overlap[HOP:], 0
                weight[:-HOP], weight[-HOP:] = weight[HOP:], 0
            if blocks:
                output.write(np.concatenate(blocks))
            buffer = buffer[count * HOP:]
        if written != total:
            raise RuntimeError("Noise reduction changed the recording length")


def reduce_noise(source: Path, destination: Path, *, profile: NoiseProfile | None = None):
    if source.resolve() == destination.resolve():
        raise ValueError("Noise reduction must not overwrite its source")
    profile = profile if profile is not None else estimate_noise_profile(source)
    report = {"status": "skipped", "method": "fft", "algorithm": "wiener-v1", "reductionDb": 0,
              "reason": "insufficient_noise_profile"}
    if profile is None:
        return source, report
    _filter(source, destination, profile)
    before, after = [], []
    with sf.SoundFile(source) as original, sf.SoundFile(destination) as filtered:
        if len(original) != len(filtered) or filtered.samplerate != RATE:
            raise RuntimeError("Noise reduction changed the recording timeline")
        for position in profile.positions:
            original.seek(position); filtered.seek(position)
            before.append(np.mean(original.read(PROFILE_FRAME, dtype="float64") ** 2))
            after.append(np.mean(filtered.read(PROFILE_FRAME, dtype="float64") ** 2))
    reduction = float(10 * np.log10(max(np.mean(before), 1e-20) / max(np.mean(after), 1e-20)))
    if not np.isfinite(reduction) or reduction < 1:
        report["reason"] = "limited_reduction"
        return source, report
    return destination, {"status": "applied", "method": "fft", "algorithm": "wiener-v1",
                         "reductionDb": MAX_REDUCTION_DB, "noiseFloorDb": round(max(-80, min(-20, profile.floor_db)), 2),
                         "profileFrames": len(profile.positions), "sampleReductionDb": round(reduction, 2)}
