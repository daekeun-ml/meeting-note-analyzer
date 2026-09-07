"""Generate a synthetic (but realistic) Korean product meeting transcript in the STT output format.

Usage: python make_sample_transcript.py <meetingId> > transcript.json
Three speakers, ~12 minutes, mixed Korean/English terms, with self-introductions and addressing so the
speaker-attribution stage has something to work with.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

MEETING_ID = sys.argv[1] if len(sys.argv) > 1 else "sample-meeting"

# (speaker, text, seconds)
LINES = [
    ("S1", "네, 다 들어오셨죠? 그럼 9월 첫째 주 주간회의 시작하겠습니다. 저는 PM 김민수고요, 오늘 안건은 세 가지입니다. 결제 모듈 배포 일정, 고객사 A 피드백, 그리고 다음 분기 채용 건입니다.", 14),
    ("S2", "안녕하세요, 백엔드 리드 이서연입니다. 결제 모듈은 스테이징 테스트가 거의 끝났고, PG사 연동 쪽에서 타임아웃 이슈가 하나 남아 있습니다.", 11),
    ("S3", "디자인 파트 박지훈입니다. 저는 고객사 A 피드백 정리해 왔습니다.", 6),
    ("S1", "좋습니다. 서연님, 타임아웃 이슈부터 설명 부탁드려요. 배포가 9월 15일인데 영향이 있나요?", 8),
    ("S2", "PG사 API가 피크 시간대에 3초 이상 걸리는 경우가 있어서 우리 쪽 timeout이 2초로 잡혀 있으면 결제 실패로 처리됩니다. retry를 붙이거나 timeout을 5초로 늘리는 두 가지 방안이 있습니다.", 16),
    ("S1", "retry를 붙이면 중복 결제 위험은 없나요?", 4),
    ("S2", "idempotency key를 이미 쓰고 있어서 중복 결제는 안 납니다. 다만 사용자 대기 시간이 최대 10초까지 늘어날 수 있어요.", 9),
    ("S3", "UX 관점에서는 10초는 좀 길어요. 로딩 화면에 진행 상태를 보여주는 걸 같이 넣으면 좋겠습니다.", 8),
    ("S1", "그러면 timeout 5초 + retry 1회로 가고, 지훈님이 로딩 상태 UI를 이번 주 안에 시안으로 주시는 걸로 하죠. 서연님은 목요일까지 스테이징에 반영 가능할까요?", 13),
    ("S2", "네, 목요일 오후까지 반영하고 부하 테스트 결과 공유드리겠습니다.", 6),
    ("S1", "결정된 걸로 하겠습니다. 다음은 고객사 A 피드백이요. 지훈님.", 5),
    ("S3", "고객사 A에서 대시보드 차트가 모바일에서 잘린다는 피드백이 세 건 들어왔습니다. 그리고 엑셀 export 기능을 요청했어요. 차트 문제는 반응형 처리가 빠져 있어서 생긴 거라 이번 스프린트에 고칠 수 있습니다.", 17),
    ("S2", "엑셀 export는 백엔드 작업이 좀 커요. 데이터가 10만 행 넘는 경우 비동기 처리가 필요해서 최소 2주는 봐야 합니다.", 10),
    ("S1", "고객사 A 계약 갱신이 10월이라 export는 중요합니다. 우선순위를 올려서 다음 스프린트에 넣을 수 있을까요?", 9),
    ("S2", "결제 모듈 배포 이후에 바로 시작하면 10월 초에는 가능합니다. 다만 그러면 알림 서비스 리팩토링은 밀립니다.", 9),
    ("S1", "알림 리팩토링은 한 스프린트 미루죠. 대신 지훈님이 고객사 A에 일정 공유 메일을 내일까지 보내주세요.", 8),
    ("S3", "네, 내일 오전에 보내겠습니다. 모바일 차트 수정은 제가 프론트 팀에 티켓 만들어 두겠습니다.", 7),
    ("S1", "마지막 안건, 채용이요. 백엔드 한 명 추가 채용 승인이 났고요, JD는 서연님이 초안 작성해 주시면 제가 인사팀에 넘기겠습니다. 다음 주 수요일까지 가능할까요?", 12),
    ("S2", "가능합니다. 그런데 시니어를 뽑을지 미들을 뽑을지는 아직 못 정했어요. 예산은 시니어 기준으로 잡혀 있나요?", 8),
    ("S1", "예산은 확인해 보고 말씀드릴게요. 그 부분은 오픈 이슈로 남기겠습니다. 다른 얘기 있으신가요?", 7),
    ("S3", "한 가지만요. 다음 주 화요일 고객사 A 미팅에 서연님도 참석 가능하신지 확인이 필요합니다. export 일정 질문이 나올 것 같아서요.", 9),
    ("S2", "화요일 오후면 가능합니다. 오전은 배포 리허설이 있어요.", 5),
    ("S1", "그럼 오후로 잡아 주세요. 오늘 회의는 여기까지 하겠습니다. 정리한 액션 아이템은 노션에 올려 두겠습니다. 수고하셨습니다.", 9),
]


def build() -> dict:
    segments = []
    t = 3.0
    for i, (spk, text, dur) in enumerate(LINES, start=1):
        words = text.split(" ")
        step = dur / max(len(words), 1)
        wlist = [{"w": (" " if j else "") + w, "s": round(t + j * step, 2), "e": round(t + (j + 1) * step, 2)} for j, w in enumerate(words)]
        segments.append({"id": f"seg-{i:04d}", "start": round(t, 2), "end": round(t + dur, 2), "speaker": spk, "text": text, "words": wlist})
        t += dur + 1.5
    talk: dict[str, float] = {}
    for s in segments:
        talk[s["speaker"]] = talk.get(s["speaker"], 0) + s["end"] - s["start"]
    return {
        "version": 1,
        "meetingId": MEETING_ID,
        "language": "ko",
        "languageProbability": 0.98,
        "durationSec": round(t, 2),
        "mode": "intended",
        "model": "synthetic",
        "speakers": [{"id": k, "talkTimeSec": round(v, 1)} for k, v in sorted(talk.items(), key=lambda kv: -kv[1])],
        "segments": segments,
        "stats": {"synthetic": True},
        "normalizedAt": datetime.now(timezone.utc).isoformat(),
    }


if __name__ == "__main__":
    print(json.dumps(build(), ensure_ascii=False, indent=1))
