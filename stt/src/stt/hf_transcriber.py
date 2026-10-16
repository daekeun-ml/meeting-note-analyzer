"""Qwen/ARK transcription with Qwen word alignment, preserving the recording timeline."""
from __future__ import annotations

import logging
from collections import Counter
from pathlib import Path

from .chunks import append_chunk_words, audio_chunks, original_time_words
from .model_catalog import MODELS
from .transcriber import TranscriptionResult

log = logging.getLogger(__name__)
LANGUAGES = {"ko": "Korean", "en": "English", "ja": "Japanese", "zh": "Chinese", "yue": "Cantonese",
             "fr": "French", "de": "German", "it": "Italian", "pt": "Portuguese", "ru": "Russian", "es": "Spanish"}
LANGUAGE_CODES = {name.lower(): code for code, name in LANGUAGES.items()}
MAX_NEW_TOKENS = 1024


def validate_transcription_language(text, language):
    """Reject an obvious script mismatch before producing misleading word times."""
    hangul = sum("\uac00" <= char <= "\ud7a3" for char in text)
    kana = sum("\u3040" <= char <= "\u30ff" for char in text)
    latin = sum(char.isascii() and char.isalpha() for char in text)
    if language == "ko" and kana >= 5 and hangul <= 2:
        raise ValueError("선택한 모델이 한국어 음성을 다른 언어로 출력했습니다. Qwen 또는 CrisperWhisper로 다시 전사하세요.")
    if language == "en" and latin <= 3 and hangul + kana >= 10:
        raise ValueError("전사 결과의 언어가 지정한 영어와 다릅니다. 녹음 언어 또는 STT 모델을 확인하세요.")


def language_code(value, text=""):
    if value:
        normalized = str(value).strip().lower()
        if normalized in LANGUAGES:
            return normalized
        if normalized in LANGUAGE_CODES:
            return LANGUAGE_CODES[normalized]
        raise ValueError("이 언어의 단어 시간 정렬은 지원하지 않습니다. CrisperWhisper 모델을 선택하세요.")
    # ARK emits only text. Keep this limited to script identification, not a
    # fictitious confidence score or an additional transcription/model call.
    if any("\uac00" <= char <= "\ud7a3" for char in text):
        return "ko"
    if any("\u3040" <= char <= "\u30ff" for char in text):
        return "ja"
    if any("\u4e00" <= char <= "\u9fff" for char in text):
        return "zh"
    return "en"


def move_inputs(inputs, model, torch):
    return {key: value.to(device=model.device, dtype=model.dtype) if torch.is_tensor(value) and value.is_floating_point()
            else value.to(model.device) if torch.is_tensor(value) else value for key, value in inputs.items()}


class ForcedAligner:
    def __init__(self, path: Path, device="cuda"):
        import torch
        from transformers import AutoModelForTokenClassification, AutoProcessor
        self.torch = torch
        dtype = torch.bfloat16 if device == "cuda" else torch.float32
        self.processor = AutoProcessor.from_pretrained(str(path), local_files_only=True)
        self.model = AutoModelForTokenClassification.from_pretrained(
            str(path), dtype=dtype, local_files_only=True, attn_implementation="sdpa").to(device).eval()

    def align(self, audio, text, language):
        inputs, word_lists = self.processor.prepare_forced_aligner_inputs(
            audio=audio, transcript=text, language=LANGUAGES[language], return_tensors="pt")
        inputs = move_inputs(inputs, self.model, self.torch)
        with self.torch.inference_mode():
            output = self.model(**inputs)
        result = self.processor.decode_forced_alignment(
            logits=output.logits, input_ids=inputs["input_ids"], word_lists=word_lists,
            timestamp_token_id=self.model.config.timestamp_token_id)[0]
        if text.strip() and not result:
            raise ValueError("전사는 생성됐지만 단어별 시간 정렬 결과가 없습니다.")
        return result


class HfTranscriber:
    def __init__(self, model_key: str, path: Path, aligner: ForcedAligner, device="cuda"):
        import torch
        from transformers import AutoModelForCausalLM, AutoModelForMultimodalLM, AutoProcessor
        if model_key not in ("qwen3-asr", "ark-asr"):
            raise ValueError("Unsupported STT model")
        self.key, self.aligner, self.torch = model_key, aligner, torch
        self.name = MODELS[model_key]["repository"]
        dtype = torch.bfloat16 if device == "cuda" else torch.float32
        if model_key == "qwen3-asr":
            self.processor = AutoProcessor.from_pretrained(str(path), local_files_only=True)
            self.model = AutoModelForMultimodalLM.from_pretrained(
                str(path), dtype=dtype, local_files_only=True, attn_implementation="sdpa").to(device).eval()
        else:
            # Only the reviewed, pinned ARK snapshot is used. This is never an
            # arbitrary repository supplied in a request; all files are offline.
            self.processor = AutoProcessor.from_pretrained(str(path), local_files_only=True, trust_remote_code=True)
            self.model = AutoModelForCausalLM.from_pretrained(
                str(path), dtype=dtype, local_files_only=True, trust_remote_code=True,
                attn_implementation="sdpa").to(device).eval()

    def _chunk(self, audio, language, hotwords):
        if self.key == "qwen3-asr":
            inputs = self.processor.apply_transcription_request(
                audio=audio, language=language, prompt=", ".join(hotwords) if hotwords else None, return_tensors="pt")
            generation = {}
        else:
            instruction = (f"Please transcribe this audio in {LANGUAGES[language_code(language)]}. Do not translate."
                           if language else "Please transcribe this audio in its original spoken language. Do not translate.")
            conversation = [{"role": "user", "content": [{"type": "audio", "array": audio},
                {"type": "text", "text": instruction}]}]
            inputs = self.processor.apply_chat_template(conversation, add_generation_prompt=True, return_tensors="pt",
                sampling_rate=16000, audio_padding="longest", audio_max_length=30 * 16000, text_kwargs={"padding": "longest"})
            tokenizer = self.processor.tokenizer
            eos = tokenizer.eos_token_id
            allowed = set(eos if isinstance(eos, list) else [eos])
            bad = set(tokenizer.all_special_ids) - allowed
            bad.update(token_id for token, token_id in tokenizer.get_added_vocab().items()
                       if token.startswith("<") and token.endswith(">") and token_id not in allowed)
            generation = {"bad_words_ids": [[token] for token in sorted(bad)], "pad_token_id": tokenizer.pad_token_id,
                          "eos_token_id": eos}
        inputs = move_inputs(inputs, self.model, self.torch)
        with self.torch.inference_mode():
            output = self.model.generate(**inputs, do_sample=False, max_new_tokens=MAX_NEW_TOKENS, **generation)
        generated = output[:, inputs["input_ids"].shape[1]:]
        eos = self.model.generation_config.eos_token_id
        eos_ids = eos if isinstance(eos, (list, tuple)) else [eos]
        if generated.shape[-1] >= MAX_NEW_TOKENS and int(generated[0, -1]) not in eos_ids:
            raise ValueError("음성 구간의 전사 출력 한도를 초과했습니다. 잘린 전사는 저장하지 않았습니다.")
        if self.key == "qwen3-asr":
            parsed = self.processor.decode(generated, return_format="parsed")[0]
            return parsed["transcription"].strip(), parsed.get("language") or language
        return self.processor.batch_decode(generated, skip_special_tokens=True)[0].strip(), language

    def transcribe(self, wav: Path, *, language: str | None, mode: str, hotwords: list[str]):
        if mode != "intended":
            raise ValueError("발화 그대로 전사 모드는 CrisperWhisper에서 지원합니다.")
        words, texts, languages = [], [], Counter()
        for index, chunk in enumerate(audio_chunks(wav, overlap=2.0)):
            if len(chunk.audio) == 0 or float(abs(chunk.audio).max()) < 1e-6:
                continue
            text, detected = self._chunk(chunk.audio, language, hotwords)
            if not text:
                continue
            code = language_code(detected, text)
            validate_transcription_language(text, code)
            aligned = self.aligner.align(chunk.audio, text, code)
            append_chunk_words(words, original_time_words(chunk, aligned))
            texts.append(text)
            languages[code] += chunk.keep_end - chunk.keep_start
            if index % 20 == 0:
                log.info("STT model=%s processedThroughSec=%.1f", self.key, chunk.offset + chunk.duration)
        words.sort(key=lambda word: (word.s, word.e))
        return TranscriptionResult(words=words, language=languages.most_common(1)[0][0] if languages else language,
                                   language_probability=None, text=" ".join(texts))
