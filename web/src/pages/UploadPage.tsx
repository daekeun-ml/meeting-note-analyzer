import { DEFAULT_AUDIO_PROCESSING } from "@meeting-notes/shared";
import { AudioProcessingSettings } from "../components/AudioProcessingSettings";
import { UploadSpeechModels, useSpeechModelChoice } from "../components/SpeechModels";
import { useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CONSTRAINTS, type OutputLanguage } from "@meeting-notes/shared";
import { useApi } from "../lib/api";
import { FilePicker } from "../components/FilePicker";
import { uploadMultipart } from "../lib/upload";
import { IconFileAudio, IconGlobe, IconLanguage, IconVideo, IconUsers } from "../components/icons";
import { LectureUploadForm } from "./LectureUploadPage";
import { InterviewUploadForm } from "./InterviewUploadPage";
import { Button, InlineError, Page, ProgressBar, SectionLabel, Segmented } from "../components/ui";

const OUTPUT_OPTIONS: { value: OutputLanguage; label: string }[] = [{ value: "ko", label: "한국어" }, { value: "en", label: "English" }, { value: "auto", label: "회의 언어 그대로" }];
const HINT_OPTIONS = [{ value: "auto", label: "자동 감지" }, { value: "ko", label: "한국어" }, { value: "en", label: "English" }, { value: "ja", label: "日本語" }, { value: "zh", label: "中文" }];

type UploadKind = "meeting" | "lecture" | "interview";
const KINDS: { value: UploadKind; label: string; icon: ReactNode; title: string; subtitle: string }[] = [
  { value: "meeting", label: "회의 녹음", icon: <IconFileAudio size={15} />, title: "새 회의 분석", subtitle: "mp3를 올리면 상세 회의록과 핵심 요약을 만듭니다" },
  { value: "lecture", label: "강의 노트", icon: <IconVideo size={15} />, title: "새 강의 정리", subtitle: "MP4 영상이나 MP3 음성으로 학습 자료를 만듭니다" },
  { value: "interview", label: "인터뷰", icon: <IconUsers size={15} />, title: "새 인터뷰 노트", subtitle: "질문과 답변을 기록하고 선택한 기준으로 평가합니다" },
];

/** One upload entry point: rounded tabs at the top switch between the meeting recording form and the lecture form (deep link: ?kind=lecture). */
export function UploadPage() {
  const [params, setParams] = useSearchParams();
  const kind: UploadKind = params.get("kind") === "interview" ? "interview" : params.get("kind") === "lecture" ? "lecture" : "meeting";
  const current = KINDS.find((k) => k.value === kind)!;
  return (
    <Page title={current.title} subtitle={current.subtitle}>
      <Segmented className="mb-6" value={kind} onChange={(next) => setParams(next === "meeting" ? {} : { kind: next }, { replace: true })} options={KINDS.map(({ value, label, icon }) => ({ value, label, icon }))} />
      {kind === "meeting" ? <MeetingUploadForm /> : kind === "lecture" ? <LectureUploadForm /> : <InterviewUploadForm />}
    </Page>
  );
}

function MeetingUploadForm() {
  const api = useApi();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [audioProcessing, setAudioProcessing] = useState(DEFAULT_AUDIO_PROCESSING);
  const [lang, setLang] = useState<OutputLanguage>("ko");
  const [hint, setHint] = useState("auto");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;
  const speech = useSpeechModelChoice(busy);
  const speechLanguage = speech.value.stt === "ark-asr" ? "en" : hint;

  const isMp3 = (f: File) => f.type === "audio/mpeg" || /\.mp3$/i.test(f.name);

  function pick(f: File | null) {
    setError(null);
    if (f && !isMp3(f)) return setError("mp3 파일만 업로드할 수 있습니다.");
    if (f && f.size > CONSTRAINTS.maxUploadBytes) return setError("파일이 너무 큽니다 (최대 500MB).");
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.mp3$/i, ""));
  }

  async function submit() {
    if (!file || speech.loading) return;
    setError(null);
    try {
      setProgress(0);
      const res = await api.createMeeting({ title: title.trim() || undefined, fileName: file.name, fileSize: file.size, contentType: "audio/mpeg", outputLanguage: lang, audioProcessing, speechModels: speech.value, languageHint: speechLanguage === "auto" ? undefined : speechLanguage });
      const parts = await uploadMultipart(file, res.upload, setProgress);
      await api.completeUpload(res.meeting.meetingId, { uploadId: res.upload.uploadId, parts });
      await qc.invalidateQueries({ queryKey: ["meetings"] });
      nav(`/meetings/${res.meeting.meetingId}`);
    } catch (e) {
      setProgress(null);
      setError((e as Error).message);
    }
  }

  return (
    <>
      <FilePicker label="회의 녹음" accept="audio/mpeg,.mp3" file={file} disabled={busy} onFile={pick} onError={setError}
        icon={<IconFileAudio className="text-accent" />} buttonLabel="mp3 파일 선택" hint="MP3 · 최대 500MB, 여러 언어가 섞인 회의도 됩니다" />

      <AudioProcessingSettings value={audioProcessing} onChange={setAudioProcessing} disabled={busy} />
      <UploadSpeechModels choice={speech} disabled={busy} />
      <div className="mt-6">
        <SectionLabel>제목</SectionLabel>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 9월 첫째 주 주간회의" disabled={busy} className="mt-2 w-full h-12 rounded-xl bg-surface border border-line px-4 text-[16px] placeholder:text-ink-3 focus:outline-none focus:border-accent" />
      </div>

      <div className="mt-6">
        <div className="flex items-center gap-1.5"><IconGlobe size={14} className="text-ink-3" /><SectionLabel>결과 언어</SectionLabel></div>
        <Segmented className="mt-2" options={OUTPUT_OPTIONS} value={lang} onChange={setLang} />
      </div>
      <div className="mt-5">
        <div className="flex items-center gap-1.5"><IconLanguage size={14} className="text-ink-3" /><SectionLabel>회의에서 쓰인 언어</SectionLabel></div>
        <Segmented className="mt-2" options={speech.value.stt === "ark-asr" ? HINT_OPTIONS.filter((option) => option.value === "en") : HINT_OPTIONS} value={speechLanguage} onChange={setHint} />
        <p className="mt-2 text-[12px] text-ink-3">{speech.value.stt === "ark-asr" ? "ARK는 영어 녹음용으로 사용합니다." : "자동 감지가 기본입니다. 힌트를 주면 전사 정확도가 올라갑니다."}</p>
      </div>

      {busy && (
        <div className="mt-6">
          <ProgressBar value={progress} />
          <p className="mt-2 text-[13px] text-ink-2">{progress < 100 ? `업로드 중 ${progress}%` : "업로드 완료. 처리를 시작합니다…"}</p>
        </div>
      )}
      {error && <InlineError>{error}</InlineError>}
      <Button full className="mt-6" loading={busy} disabled={!file || speech.loading} onClick={() => void submit()}>분석 시작</Button>
      <p className="mt-3 text-[12px] text-ink-3 leading-relaxed">업로드가 끝나면 앱을 닫아도 됩니다. 처리가 끝나면 알림으로 알려 드립니다(설정에서 알림 켜기).</p>
    </>
  );
}
