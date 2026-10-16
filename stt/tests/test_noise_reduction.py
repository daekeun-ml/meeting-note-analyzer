import hashlib

import numpy as np
import pytest
import soundfile as sf

from stt.noise_reduction import NoiseProfile, _filter, estimate_noise_profile, reduce_noise


def recording(tmp_path, colored=True):
    rate = 16000
    time = np.arange(rate * 14 + 37) / rate
    carrier = np.sin(2 * np.pi * 190 * time) + .4 * np.sin(2 * np.pi * 570 * time)
    speech = np.zeros(len(time))
    for start, end, amplitude in ((2, 4, .14), (6, 8, .015), (10, 12, .10)):
        mask = (time >= start) & (time < end)
        envelope = np.minimum(1, np.minimum((time[mask] - start) * 10, (end - time[mask]) * 10))
        speech[mask] = amplitude * carrier[mask] * envelope
    noise = np.random.default_rng(14).normal(size=len(time))
    if colored:
        frequencies = np.fft.rfftfreq(len(noise), 1 / rate)
        noise = np.fft.irfft(np.fft.rfft(noise) / np.sqrt(1 + (frequencies / 250) ** 2), n=len(noise))
    noise *= .01 / np.sqrt(np.mean(noise ** 2))
    source = tmp_path / "source.wav"
    sf.write(source, speech + noise, rate, subtype="PCM_16")
    return source, time, speech


@pytest.mark.parametrize("colored", [False, True])
def test_stationary_noise_is_reduced_without_removing_quiet_speech_or_shifting_time(tmp_path, colored):
    source, time, clean = recording(tmp_path, colored)
    original, _ = sf.read(source)
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    target, report = reduce_noise(source, tmp_path / "filtered.wav")
    assert report["status"] == "applied" and report["profileFrames"] >= 4
    filtered, rate = sf.read(target)
    assert rate == 16000 and len(filtered) == len(original)
    quiet = ((time > .5) & (time < 1.5)) | ((time > 4.5) & (time < 5.5)) | ((time > 12.5) & (time < 13.5))
    reduction = 10 * np.log10(np.mean(original[quiet] ** 2) / np.mean(filtered[quiet] ** 2))
    assert reduction > 3, reduction
    weak = (time > 6.3) & (time < 7.7)
    strong = (time > 2.3) & (time < 3.7)
    for mask, minimum in ((weak, .78), (strong, .95)):
        # Projection onto the known clean reference checks voice retention,
        # unlike output RMS which includes the noise we intend to remove.
        gain = np.dot(filtered[mask], clean[mask]) / np.dot(clean[mask], clean[mask])
        assert minimum < gain < 1.03, gain
        assert np.mean((filtered[mask] - clean[mask]) ** 2) < np.mean((original[mask] - clean[mask]) ** 2)
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before


@pytest.mark.parametrize("kind", ["silence", "clean_voice", "short"])
def test_uncertain_profile_keeps_input_and_reports_skipped(tmp_path, kind):
    rate = 16000
    time = np.arange(rate * (1 if kind == "short" else 10)) / rate
    audio = np.zeros(len(time)) if kind == "silence" else .2 * np.sin(2 * np.pi * 190 * time)
    source, destination = tmp_path / "source.wav", tmp_path / "filtered.wav"
    sf.write(source, audio, rate)
    target, report = reduce_noise(source, destination)
    assert target == source and report["status"] == "skipped"
    assert report["reductionDb"] == 0 and not destination.exists()


def test_streaming_overlap_add_preserves_boundaries_and_does_not_delay_audio(tmp_path):
    rate = 16000
    source, destination = tmp_path / "source.wav", tmp_path / "filtered.wav"
    audio = np.random.default_rng(2).normal(0, .1, rate * 5 + 61)
    audio[[0, rate * 2, len(audio) - 1]] = .7
    sf.write(source, audio, rate, subtype="PCM_16")
    profile = NoiseProfile(np.full(257, 1e-16), [], -80)
    _filter(source, destination, profile)
    original, _ = sf.read(source)
    filtered, _ = sf.read(destination)
    assert len(filtered) == len(original)
    assert np.max(abs(filtered - original)) <= 1 / 32768 + 1e-12


def test_negligible_reduction_is_not_claimed_as_applied(tmp_path):
    source, _, _ = recording(tmp_path)
    target, report = reduce_noise(source, tmp_path / "filtered.wav",
                                 profile=NoiseProfile(np.full(257, 1e-16), [4000, 20000], -80))
    assert target == source and report["status"] == "skipped" and report["reason"] == "limited_reduction"


def test_original_cannot_be_overwritten(tmp_path):
    source, _, _ = recording(tmp_path)
    with pytest.raises(ValueError, match="overwrite"):
        reduce_noise(source, source)


def test_rejects_wrong_sample_rate(tmp_path):
    source = tmp_path / "source.wav"
    sf.write(source, np.zeros(48000 * 5), 48000)
    with pytest.raises(ValueError, match="16 kHz mono"):
        estimate_noise_profile(source)


@pytest.mark.parametrize("colored", [False, True])
def test_short_weak_unvoiced_onset_is_not_learned_as_noise(tmp_path, colored):
    source, time, _ = recording(tmp_path, colored)
    original, rate = sf.read(source)
    onset = (time > 5.85) & (time < 6)
    consonant = np.random.default_rng(24).normal(size=sum(onset))
    frequency = np.fft.rfftfreq(len(consonant), 1 / rate)
    consonant = np.fft.irfft(np.fft.rfft(consonant) * ((frequency > 1500) & (frequency < 6000)), n=len(consonant))
    consonant *= .008 / np.sqrt(np.mean(consonant ** 2))
    original[onset] += consonant
    sf.write(source, original, rate)
    target, report = reduce_noise(source, tmp_path / "filtered.wav")
    assert report["status"] == "applied"
    filtered, _ = sf.read(target)
    assert np.dot(filtered[onset], consonant) / np.dot(consonant, consonant) > .70
