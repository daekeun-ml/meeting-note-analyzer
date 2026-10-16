"""Create processed transcript/media alongside the untouched source recording."""
from __future__ import annotations

import logging
import uuid
from pathlib import Path
from botocore.exceptions import ClientError

from .audio import export_mp3, export_video
from .scope import choose_scope, full_scope
from .terminology import VERSION as DICTIONARY_VERSION, correct_terms
from .schemas import SttRequest, SttResponse

log = logging.getLogger(__name__)
PREFIXES = {"meeting": "results", "lecture": "lecture-results", "interview": "interview-results"}

class RecordingDeleted(RuntimeError):
    pass


def ensure_active(s3, bucket, request):
    try:
        s3.head_object(Bucket=bucket, Key=f"stt/deleted/{request.kind}/{request.meetingId}.json")
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return
        raise
    raise RecordingDeleted("Recording was deleted")


def s3_parts(uri):
    if not uri.startswith("s3://") or "/" not in uri[5:]:
        raise ValueError("Media source must be an S3 object")
    bucket, key = uri[5:].split("/", 1)
    if not bucket or not key:
        raise ValueError("Media source must be an S3 object")
    return bucket, key


def process_transcript(raw: SttResponse, request: SttRequest, wav: Path, workdir: Path, s3, noise: dict, scope_client=None, *, bitrate_kbps=64):
    if not any((request.processing.denoise, request.processing.trim, request.processing.terminology)):
        return raw
    bucket, _ = s3_parts(request.audio_s3_uri)
    ensure_active(s3, bucket, request)
    scope = choose_scope(raw.segments, raw.durationSec, request, scope_client)
    excluded = set(scope["excludedSegmentIds"])
    scope["excludedSegmentCount"] = len(excluded)
    kept = [segment for segment in raw.segments if segment.id not in excluded]
    if raw.segments and not kept:
        scope = full_scope(raw.durationSec, "review_required", "발언 전체가 제외되지 않도록 원문을 유지했습니다.")
        scope["excludedSegmentCount"] = 0
        kept = raw.segments
    terms = {"version": DICTIONARY_VERSION, "applied": 0, "review": 0}
    if request.processing.terminology:
        kept, terms = correct_terms(kept, request.kind, request.title + " " + request.context)
    talk = {}
    for segment in kept:
        talk[segment.speaker] = talk.get(segment.speaker, 0) + segment.end - segment.start
    processing = {"version": 1, "kind": request.kind, "noise": noise, "scope": scope,
                  "terms": terms, "media": {}, "warnings": []}
    prefix = f"{PREFIXES[request.kind]}/{request.meetingId}/processed/{uuid.uuid4().hex}/"
    uploaded = []
    def check_after_upload():
        try:
            ensure_active(s3, bucket, request)
        except Exception:
            processing["media"].clear()
            for key in uploaded:
                s3.delete_object(Bucket=bucket, Key=key)
            uploaded.clear()
            raise
    def upload(path, key, content_type):
        ensure_active(s3, bucket, request)
        s3.upload_file(str(path), bucket, key, ExtraArgs={"ContentType": content_type})
        uploaded.append(key)
        check_after_upload()
    start, end = scope["startSec"], scope["endSec"]
    audio = workdir / "processed.mp3"
    try:
        export_mp3(wav, audio, start, end, bitrate_kbps=bitrate_kbps)
        key = prefix + "audio.mp3"
        upload(audio, key, "audio/mpeg")
        processing["media"]["audio"] = {"key": key, "startSec": start, "endSec": end}
    except RecordingDeleted:
        raise
    except Exception as error:
        log.warning("Processed MP3 export failed: %s", type(error).__name__)
        processing["warnings"].append("전처리 MP3 파일을 만들지 못했습니다. 원본은 그대로 사용할 수 있습니다.")
    if request.video_s3_uri:
        try:
            video_bucket, video_key = s3_parts(request.video_s3_uri)
            if request.kind != "lecture" or video_bucket != bucket or not video_key.startswith("lecture-uploads/") or video_key.split("/")[2:3] != [request.meetingId]:
                raise ValueError("Invalid video source")
            source = s3.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": video_key}, ExpiresIn=3600)
            video = workdir / "processed.mp4"
            actual_start = export_video(source, wav, video, start, end)
            key = prefix + "video.mp4"
            upload(video, key, "video/mp4")
            processing["media"]["video"] = {"key": key, "startSec": actual_start, "endSec": end}
            if actual_start < start - 0.05:
                processing["warnings"].append("영상은 첫 발언과 화면을 놓치지 않도록 분석 시작보다 앞선 재생 지점부터 저장했습니다. 파일별 원본 시간 범위를 확인하세요.")
        except RecordingDeleted:
            raise
        except Exception as error:
            log.warning("Processed MP4 export failed: %s", type(error).__name__)
            processing["warnings"].append("전처리 MP4 파일을 만들지 못했습니다. 원본 영상은 그대로 사용할 수 있습니다.")
    check_after_upload()
    return raw.model_copy(update={
        "segments": kept, "originalSegments": raw.segments, "processing": processing,
        "speakers": [speaker.model_copy(update={"talkTimeSec": round(talk[speaker.id], 3)})
                     for speaker in raw.speakers if speaker.id in talk],
    })
