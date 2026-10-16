"""Cached, optional wording for simplified exports; never used as scoring evidence."""
import hashlib
import json
import logging
import re
from typing import Annotated

from botocore.exceptions import ClientError
from pydantic import Field, create_model

from .parallel import parallel_map
from .schemas import Strict

log = logging.getLogger(__name__)


class ReadingNote(Strict):
    topic: str = Field(min_length=1, max_length=160)
    question: str = Field(min_length=1, max_length=2000)
    answer: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(max_length=4)
    hint: str | None = Field(default=None, max_length=1000)


class ResumeReadingNote(Strict):
    claim: str = Field(min_length=1, max_length=1000)
    explanation: str = Field(min_length=1, max_length=2000)


READING_TASK = """Create a concise but informative reading copy of EACH supplied interview question, in notesLanguage.
Return the same question-ID fields. Each value has topic, question, answer, hint.
The entire candidate answer should be roughly FORTY PERCENT of its original length. The supplied answerTargetCharacters
is the TOTAL writing budget across all answer bullets, not the budget for each bullet. Aim near that target.
Use 1–4 readable bullet sentences, normally 2–3. Retain the method, the candidate's reasoning, outcome, one useful example and material limitations.
Combine related points. Omit repetition, speech narration, exhaustive examples and phrases like 'the candidate stated'.
Keep short answers short; do not pad them. An empty input answer MUST remain an empty answer list.
Use ONLY the answer field as evidence of what the candidate said. Preserve wrong explanations, negations, uncertainty,
self-reported versus demonstrated work and reliance on hints when present in the answer. Do not fix their science,
invent accomplishments, add grades, or infer inability from an unclear/missing answer.
The interviewerHints field is separate context: never insert its facts into the candidate answer.
hint defaults to null. Include at most ONE substantive technical hint or correction ONLY when it is necessary to
understand the candidate's answer or reliance on help. Omit logistics, topic transitions, question restatements,
announcements of a follow-up and remarks such as "설명 기반으로 후속 질문 예정이라 안내".
question is a compact restatement near questionTargetCharacters. Preserve the actual ask and essential constraints.
topic is a BROAD section label, shared across related questions: e.g. ML / AI, Agent, RAG, System Architecture,
경험과 협업. Avoid a unique heading for each question. These examples are labels, not extra interview evidence.
Do not include internal IDs in prose, resume background, source-policy disclaimers, transcript commentary,
generic review notices, invented correct answers, or interviewer administrative chatter.
Omit boilerplate annotations such as "(일부 발화 불명확)"; preserve meaningful uncertainty about what the candidate
claimed, and never fill inaudible speech with a guess. Avoid middle dots and em dashes in prose: use words,
commas or separate sentences. Preserve mathematical operators and technical names.
Return only the concise reading copy. The original evidence and assessment are retained separately."""

UNCLEAR_NOTE = re.compile(r"[\[(]\s*(?:일부\s*)?(?:발화|녹음|전사|음성|인식)(?:\s*(?:내용|가|이))?\s*(?:불명확|불확실|판독 불가)\s*[\])]")
ADMIN_HINT = re.compile(r"(?:후속|추가)\s*질문.*(?:예정|안내|예고)|(?:설명|답변).*기반.*질문.*(?:안내|예정)|(?:면접|인터뷰).*(?:마무리|종료).*안내")


def reading_text(text):
    # Presentation only: original answers and evidence remain untouched.
    protected = re.compile(r"(```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]+?\$\$|\$[^$\n]+\$)")
    def prose(value):
        value = UNCLEAR_NOTE.sub("", value).replace("—", ", ")
        value = re.sub(r"(?<=[가-힣A-Za-z]{2})[·∙](?=[가-힣A-Za-z](?:[가-힣A-Za-z]|-))", ", ", value)
        return re.sub(r"[ \t]{2,}", " ", value)
    return "".join(part if i % 2 else prose(part) for i, part in enumerate(protected.split(text))).strip()


def reading_hint(text):
    return None if not text or ADMIN_HINT.search(text) else reading_text(text) or None

RESUME_READING_TASK = """이력서 주장과 이미 작성된 면접 대조 의견을 한국어로 매우 짧게 정리하세요.
각 입력 ID에 claim과 explanation을 반환하세요.
claim: 경험·기술의 핵심만 담은 짧은 한국어 제목(약 15~35자). 직무·기술 고유명사는 유지하세요.
explanation: 확인된 핵심 차이를 한국어 1~2문장, 가능하면 40~90자로 요약하세요. 긴 원문을 번역해 나열하지 마세요.
이력서 내용을 반복하거나 프로젝트·항목 번호를 열거하지 마세요. 평가 status와 근거의 의미를 바꾸지 마세요.
supported는 답변에서 확인된 내용, gap은 주장 대비 실제 확인된 부족한 부분, uncertain은 판단이 불확실한 이유,
not_tested는 면접에서 구체적으로 검증하지 않았다는 점만 짧게 쓰세요. 미검증을 역량 부족으로 바꾸지 마세요.
점수·합격 여부·정직성·새로운 사실을 추가하지 마세요. r1, q1, seg-0001 같은 내부 번호와 형식적인 안내문을 빼세요.
영문 기술명 외의 설명은 반드시 한국어로 작성하세요."""


def _reading_map(items, model, cache, language, check, *, name, version, task, item_schema, validate_item):
    batches, current, size = [], [], 0
    for item in items:
        length = len(json.dumps(item, ensure_ascii=False))
        if current and (len(current) >= 6 or size + length > 24_000):
            batches.append(current)
            current, size = [], 0
        current.append(item)
        size += length
    if current:
        batches.append(current)

    def summarize(batch):
        data = {"notesLanguage": language, "items": batch}
        signature = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]
        schema = create_model(name, __base__=Strict, **{e["id"]: (item_schema, ...) for e in batch})
        def validate(value):
            for source in batch:
                item = getattr(value, source["id"])
                validate_item(source, item)
                if re.search(r"\b(?:seg-\d+|[qr]\d+)\b", json.dumps(item.model_dump(), ensure_ascii=False)):
                    raise ValueError("Reading copy must omit internal source IDs")
        try:
            value = schema.model_validate(cache(f"{version}-{signature}",
                lambda: model.generate(schema, task, data, validate=validate).model_dump()))
            validate(value)
            return value.model_dump()
        except (ValueError, ClientError):
            log.warning("%s unavailable; keeping the original validated record", name)
            return {}
        except RuntimeError as error:
            if not str(error).startswith("Lecture model-call limit reached"):
                raise
            log.warning("No model budget left for %s", name)
            return {}
    return {key: value for result in parallel_map(batches, summarize, check=check) for key, value in result.items()}


def concise_reading_notes(exchanges, model, cache, language, check):
    items = [{"id": e["id"], "question": e["question"], "topic": e["topic"],
              "answer": [p["text"] for p in e["answer"]], "interviewerHints": e.get("briefInterviewerContext", []),
              "answerTargetCharacters": max(15, round(sum(len(p["text"]) for p in e["answer"]) * 0.4)),
              "questionTargetCharacters": min(len(e["question"]), max(20, min(45, round(len(e["question"]) * 0.4))))}
             for e in exchanges]
    def validate(source, value):
        if bool(source["answer"]) != bool(value.answer):
            raise ValueError("Keep empty answers empty; summarize provided answers without discarding them")
        if not source["interviewerHints"] and value.hint:
            raise ValueError("Do not invent an interviewer hint")
    summaries = _reading_map(items, model, cache, language, check, name="InterviewReadingNotes",
                             version="reading-notes-v2", task=READING_TASK, item_schema=ReadingNote, validate_item=validate)
    for note in summaries.values():
        note["topic"], note["question"] = reading_text(note["topic"]), reading_text(note["question"])
        note["answer"] = [clean for item in note["answer"] if (clean := reading_text(item))]
        note["hint"] = reading_hint(note.get("hint"))
    return [{**e, **({"readingNotes": summaries[e["id"]]} if e["id"] in summaries else {})} for e in exchanges]


def korean_resume_notes(comparisons, claims, model, cache, check):
    by_id = {claim["id"]: claim["text"] for claim in claims}
    items = [{"id": c["claimId"], "claim": by_id.get(c["claimId"], ""), "status": c["status"], "explanation": c["explanation"]}
             for c in comparisons]
    def validate(source, value):
        if not re.search("[가-힣]", value.explanation):
            raise ValueError("Resume comparison explanations must be written in Korean")
    summaries = _reading_map(items, model, cache, "ko", check, name="ResumeReadingNotes",
                             version="resume-reading-ko-v1", task=RESUME_READING_TASK, item_schema=ResumeReadingNote, validate_item=validate)
    return [{**c, **({"readingNotes": summaries[c["claimId"]]} if c["claimId"] in summaries else {})} for c in comparisons]

HINTS_TASK = """Prepare concise interviewer-hint bullets for the supplied interview questions, in notesLanguage.
Use ONLY each question's interviewerContext. Summarize what the interviewer actually supplied or corrected.
Return a field for each supplied question ID, containing zero to three SHORT bullet strings.
Each bullet should be one compact sentence or phrase, aiming for 20–30 Korean words or 15–25 English words.
Choose the essential hint, technical terms, supplied numbers, or correction; omit repeated question setup and filler.
Examples of the desired Korean style: "알고리즘 상세보다 두 방식의 근본적인 차이를 질문함.",
"BERT, S-BERT와 리랭커를 관련 맥락으로 언급함.", "이미지의 공간 정보와 마스킹의 일반화 효과를 설명함."
These are STYLE examples only; never copy facts absent from the source question.
Preserve qualifications and negations. Do not silently correct a technically mistaken interviewer premise.
Do not turn interviewer-provided explanations into candidate knowledge or add candidate answers.
Omit candidate pauses/reactions, transcript IDs, attribution disclaimers, generic uncertainty notices,
absence-of-further-hints commentary, unrelated job explanations, feedback logistics, and interview wrap-up.
Omit announcements of follow-up questions, generic instructions and transitions such as
"설명 기반으로 후속 질문 예정이라 안내". Keep only substantive technical information needed to understand the answer.
Avoid middle dots and em dashes in prose. Do not include "(일부 발화 불명확)" or similar boilerplate.
If a fragment is too unclear to summarize faithfully, omit it; do not guess. Use [] for no relevant hint.
No introductions, Markdown markers, extra explanations or reconstructed ideal answers.
The output is presentation wording only; do not score the candidate or make any hiring recommendation."""


def brief_interviewer_context(exchanges, model, cache, language, check):
    """Add optional brief wording to copies, preserving the original answers and interviewer evidence."""
    sources = [{"id": e["id"], "question": e["question"],
                "interviewerContext": [p["text"] for p in e["interviewerContext"]]}
               for e in exchanges if e["interviewerContext"]]
    batches, current, size = [], [], 0
    for source in sources:
        length = len(json.dumps(source, ensure_ascii=False))
        if current and (len(current) >= 8 or size + length > 20_000):
            batches.append(current)
            current, size = [], 0
        current.append(source)
        size += length
    if current:
        batches.append(current)

    def summarize(batch):
        data = {"notesLanguage": language, "questions": batch}
        signature = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]
        bullet = Annotated[str, Field(min_length=1, max_length=2000)]
        schema = create_model("InterviewerHints", __base__=Strict,
                              **{e["id"]: (list[bullet], Field(max_length=3)) for e in batch})
        def validate(value):
            if any(re.search(r"\b(?:seg-\d+|[qr]\d+)\b", text) for hints in value.model_dump().values() for text in hints):
                raise ValueError("Hint bullets must omit internal transcript, question and resume IDs")
        try:
            value = schema.model_validate(cache(f"brief-hints-v2-{signature}",
                lambda: model.generate(schema, HINTS_TASK, data, validate=validate).model_dump()))
            validate(value)
            return {key: [clean for item in items if (clean := reading_hint(item))] for key, items in value.model_dump().items()}
        except (ValueError, ClientError):
            # A failed presentation pass must not discard a completed interview analysis.
            log.warning("Brief hint wording unavailable; retaining original interviewer context")
            return {}
        except RuntimeError as error:
            if not str(error).startswith("Lecture model-call limit reached"):
                raise  # Cancellation/lease failures still stop the original run.
            log.warning("No model budget left for brief hint wording; retaining original context")
            return {}

    summaries = {e["id"]: [] for e in exchanges if not e["interviewerContext"]}
    for result in parallel_map(batches, summarize, check=check):
        summaries.update(result)
    return [{**e, **({"briefInterviewerContext": summaries[e["id"]]} if e["id"] in summaries else {})} for e in exchanges]
