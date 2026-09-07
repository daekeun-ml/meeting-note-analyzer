FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PATH=/app/.venv/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libreoffice-impress fonts-noto-cjk fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* && useradd -m -u 1000 lecturer
COPY pyproject.toml /app/pyproject.toml
COPY uv.lock /app/uv.lock
COPY src /app/src
RUN pip install uv==0.9.8 && uv sync --project /app --frozen --no-dev --python python3.12
USER lecturer
WORKDIR /home/lecturer
EXPOSE 8080
CMD ["python", "-m", "lecture_study.main"]
