"""Nemotron 3 streaming inference retains speaker identity across long recordings."""
from pathlib import Path
import logging

from .align import Turn
from .hf_transcriber import move_inputs

log = logging.getLogger(__name__)


class NemotronDiarizer:
    def __init__(self, path: Path, device="cuda"):
        import torch
        from transformers import AutoModelForAudioFrameClassification, AutoProcessor
        self.torch = torch
        self.processor = AutoProcessor.from_pretrained(str(path), local_files_only=True)
        self.processor.set_streaming_mode("low_latency")
        self.model = AutoModelForAudioFrameClassification.from_pretrained(
            str(path), local_files_only=True, dtype=torch.float32).to(device).eval()

    def diarize(self, wav: Path, *, min_speakers=None, max_speakers=None):
        import soundfile as sf
        if (min_speakers or 0) > 8 or (max_speakers or 0) > 8:
            raise ValueError("Nemotron 3는 최대 8명의 화자를 구분합니다.")
        # The network has eight fixed output channels; do not pretend a count
        # hint changed them. A pyannote model is available for count constraints.
        if min_speakers is not None or max_speakers is not None:
            raise ValueError("화자 수 범위 지정은 pyannote Community-1에서 지원합니다.")
        logits, speaker_cache = [], None
        processor, torch = self.processor, self.torch
        with sf.SoundFile(wav) as stream:
            if stream.samplerate != 16000 or stream.channels != 1:
                raise ValueError("Diarization requires 16 kHz mono audio")
            total = len(stream)
            if not total:
                return []
            frame, start, first, count = 0, 0, True, 0
            while start < total:
                size = processor.num_samples_first_audio_chunk if first else processor.num_samples_per_audio_chunk
                end = min(total, start + size)
                stream.seek(start)
                audio = stream.read(end - start, dtype="float32")
                last = end == total
                inputs = processor(audio, sampling_rate=16000, is_streaming=True, is_first_audio_chunk=first,
                                   is_last_audio_chunk=last, return_tensors="pt")
                inputs = move_inputs(inputs, self.model, torch)
                with torch.inference_mode():
                    output = self.model(**inputs, speaker_cache=speaker_cache)
                logits.append(output.logits.detach().cpu())
                speaker_cache = output.speaker_cache
                count += 1
                if last:
                    break
                first = False
                frame += processor.num_mel_frames_per_step
                start = processor.audio_chunk_start(frame)
                if count % 600 == 0:
                    log.info("Diarization model=nemotron3 processedThroughSec=%.1f", end / 16000)
        # The processor reports original recording time after concatenation.
        segments = processor.extract_speaker_dict(torch.cat(logits, dim=1))[0]
        duration = total / 16000
        return [Turn(max(0, float(row["Start"])), min(duration, float(row["End"])), f"SPEAKER_{int(row['Speaker']):02d}")
                for row in segments if 0 <= float(row["Start"]) < min(duration, float(row["End"]))]
