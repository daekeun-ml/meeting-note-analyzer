# SageMaker BYOC image (x86_64 GPU): CrisperWhisper 2.0 (CTranslate2) + pyannote.audio 4 diarization.
# Contract: `docker run <image> serve` -> HTTP :8080 with GET /ping, POST /invocations.
FROM nvidia/cuda:12.6.3-cudnn-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    VIRTUAL_ENV=/opt/venv PATH=/opt/venv/bin:$PATH \
    MODEL_DIR=/opt/ml/model STT_BACKEND=ct2 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
    CRISPERWHISPER_CACHE=/tmp/crisperwhisper-cache

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv ffmpeg curl ca-certificates libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# plain venv + pip: the image is built under qemu on an arm64 workstation, where the uv binary segfaults.
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir --upgrade pip wheel

# torch stack first (cu126 wheels), then the rest; versions pinned for reproducibility.
RUN /opt/venv/bin/pip install --no-cache-dir torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu126
RUN /opt/venv/bin/pip install --no-cache-dir \
      "torchcodec==0.7.0" "pyannote.audio>=4.0.0,<5" "crisperwhisper[ct2]==2.0.2" \
      "fastapi>=0.115" "uvicorn>=0.30" "boto3>=1.35" "numpy>=1.26" "soundfile>=0.12" "pydantic>=2.8"

# PyPI 2.0.2 predates the upstream fix "decode each word's tokens together so UTF-8 survives" (2026-08-18);
# layer the pinned upstream source on top (pure Python; the CT2 fork wheel from the layer above stays).
ARG CRISPERWHISPER_COMMIT=b60a35313d6538de82dd26d00947c21b884414d4
RUN /opt/venv/bin/pip uninstall -y crisperwhisper && /opt/venv/bin/pip install --no-cache-dir --no-deps \
      "https://github.com/nyrahealth/CrisperWhisper/archive/${CRISPERWHISPER_COMMIT}.tar.gz" \
    && grep -q "def decode_word_texts" /opt/venv/lib/python3.12/site-packages/crisperwhisper/word_timing.py

WORKDIR /app
COPY src /app/src
ENV PYTHONPATH=/app/src
COPY serve /usr/local/bin/serve
RUN chmod +x /usr/local/bin/serve
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/serve"]
