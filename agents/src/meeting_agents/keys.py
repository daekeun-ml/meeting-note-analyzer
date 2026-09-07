"""S3 key layout (mirror of packages/shared/src/keys.ts)."""


def transcript_json(meeting_id: str) -> str:
    return f"transcripts/{meeting_id}/transcript.json"


def transcript_md(meeting_id: str) -> str:
    return f"transcripts/{meeting_id}/transcript.md"


def stage_result(meeting_id: str, stage: str) -> str:
    return f"results/{meeting_id}/{stage}.json"


def attributed_transcript(meeting_id: str) -> str:
    return f"results/{meeting_id}/transcript_attributed.json"
