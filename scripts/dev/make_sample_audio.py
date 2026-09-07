"""Synthesize the sample meeting script into ONE mp3 with Amazon Polly, one distinct voice per speaker.

Usage: python make_sample_audio.py <out-local-path>
Korean Polly voices are limited to Seoyeon and Jihye, so S1/S3 share Seoyeon on different engines
(neural vs standard) — enough for pyannote to separate S1/S2 acoustically; S3 is the hard case that the
LLM speaker_attribution stage must resolve from context. Lines are synthesized as 16 kHz PCM and joined
with 800 ms of silence, then written as mp3 via libsndfile (no ffmpeg needed).
"""
from __future__ import annotations

import sys
from html import escape
from pathlib import Path

import boto3
import numpy as np
import soundfile as sf

from make_sample_transcript import LINES

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "sample-meeting.mp3")
RATE = 16000
VOICES = {"S1": ("Seoyeon", "neural"), "S2": ("Jihye", "neural"), "S3": ("Seoyeon", "standard")}
STYLE = {"S1": "medium", "S2": "95%", "S3": "108%"}


def main() -> None:
    polly = boto3.client("polly", region_name="us-east-1")
    gap = np.zeros(int(RATE * 0.8), dtype=np.int16)
    chunks: list[np.ndarray] = []
    for spk, text, _ in LINES:
        voice, engine = VOICES[spk]
        ssml = f'<speak><prosody rate="{STYLE[spk]}">{escape(text)}</prosody></speak>'
        pcm = polly.synthesize_speech(Text=ssml, TextType="ssml", VoiceId=voice, Engine=engine, OutputFormat="pcm", SampleRate=str(RATE))["AudioStream"].read()
        chunks += [np.frombuffer(pcm, dtype=np.int16), gap]
    audio = np.concatenate(chunks)
    sf.write(str(OUT), audio, RATE, format="MP3")
    print(f"wrote {OUT} ({OUT.stat().st_size/1024:.0f} KB, {len(audio)/RATE:.0f}s, {len(LINES)} lines, voices={sorted({v for v,_ in VOICES.values()})})")


if __name__ == "__main__":
    main()
