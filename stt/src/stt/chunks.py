"""Bounded audio windows with original-time offsets for ASR and forced alignment."""
from dataclasses import dataclass
import re

from .schemas import Word


@dataclass
class AudioChunk:
    audio: object
    offset: float
    keep_start: float
    keep_end: float
    duration: float


def audio_chunks(path, *, seconds=30.0, overlap=1.0):
    import soundfile as sf
    if not 0 <= overlap < seconds or seconds > 30:
        raise ValueError("Unsupported audio chunk size")
    with sf.SoundFile(path) as stream:
        rate = stream.samplerate
        if rate != 16000 or stream.channels != 1:
            raise ValueError("Speech models require 16 kHz mono audio")
        total = len(stream)
        width, step = round(seconds * rate), round((seconds - overlap) * rate)
        for start in range(0, total, step):
            if start and start + round(overlap * rate) >= total:
                break  # Already covered by the previous window.
            stream.seek(start)
            samples = stream.read(min(width, total - start), dtype="float32")
            end = start + len(samples)
            yield AudioChunk(samples, start / rate,
                             start / rate + (overlap / 2 if start else 0),
                             end / rate - (overlap / 2 if end < total else 0),
                             len(samples) / rate)
            if end == total:
                break


def original_time_words(chunk, aligned):
    """Use actual forced-alignment times; never fabricate uniform word timestamps."""
    words = []
    for item in aligned:
        start, end = float(item["start_time"]), float(item["end_time"])
        if not (0 <= start <= end <= chunk.duration + .2):
            raise ValueError("Aligned word lies outside its audio window")
        start, end = start + chunk.offset, min(end, chunk.duration) + chunk.offset
        if chunk.keep_start <= (start + end) / 2 < chunk.keep_end:
            words.append(Word(w=str(item["text"]), s=round(start, 3), e=round(end, 3)))
    return words


def append_chunk_words(previous, incoming):
    """Remove only duplicate recognition of the same overlapping word at a window seam."""
    normalize = lambda text: re.sub(r"\W", "", text).casefold()
    for word in incoming:
        duplicate = False
        for prior in previous[-8:]:
            overlap = min(prior.e, word.e) - max(prior.s, word.s)
            shorter = min(prior.e - prior.s, word.e - word.s)
            if shorter > 0 and overlap / shorter > .5 and normalize(prior.w) == normalize(word.w) and normalize(word.w):
                duplicate = True
                break
        if not duplicate:
            previous.append(word)
