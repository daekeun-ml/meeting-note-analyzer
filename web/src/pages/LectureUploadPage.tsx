import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LECTURE_LIMITS, SLIDE_TYPES, createLectureSchema, type CreateLectureResponse, type OutputLanguage } from "@meeting-notes/shared";
import { useApi } from "../lib/api";
import { uploadMultipart, type UploadedPart } from "../lib/upload";
import { Button, Card, InlineError, ProgressBar, SectionLabel, Segmented } from "../components/ui";
import { IconVideo, IconStudy } from "../components/icons";

/** Lecture (MP4 + optional deck) upload form; rendered inside the tabbed upload page. */
export function LectureUploadForm() {
  const api = useApi(); const nav = useNavigate(); const qc = useQueryClient();
  const [title, setTitle] = useState(""); const [course, setCourse] = useState("");
  const [video, setVideo] = useState<File | null>(null); const [slides, setSlides] = useState<File | null>(null);
  const slidesInput = useRef<HTMLInputElement>(null); const [badSlides, setBadSlides] = useState(false);
  const [language, setLanguage] = useState<OutputLanguage>("ko"); const [hint, setHint] = useState("auto");
  const [progress, setProgress] = useState(0); const [busy, setBusy] = useState(false); const [phase, setPhase] = useState("");
  const [error, setError] = useState(""); const [plan, setPlan] = useState<CreateLectureResponse | null>(null);
  const [uploaded, setUploaded] = useState({ video: false, slides: false });
  const [completedParts, setCompletedParts] = useState<Partial<Record<"video" | "slides", UploadedPart[]>>>({});
  async function submit() {
    if (!video || badSlides) return;
    setError(""); setBusy(true);
    try {
      const parsed = createLectureSchema.safeParse({ title, course, outputLanguage: language, languageHint: hint,
        video: { fileName: video.name, fileSize: video.size, contentType: "video/mp4" },
        slides: slides ? { fileName: slides.name, fileSize: slides.size, contentType: /\.pdf$/i.test(slides.name) ? SLIDE_TYPES.pdf : SLIDE_TYPES.pptx } : undefined });
      if (!parsed.success) throw new Error(parsed.error.issues.map((x) => x.message).join(", "));
      const created = plan ?? await api.createLecture(parsed.data); setPlan(created);
      for (const asset of ["slides", "video"] as const) {
        const target = created.uploads[asset]; const file = asset === "video" ? video : slides;
        if (!target || !file) continue;
        if (uploaded[asset]) continue;
        if (!completedParts[asset] && Date.now() > Date.parse(target.expiresAt)) throw new Error("업로드 링크가 만료되었습니다. 아래 강의를 삭제하고 새로 등록하세요.");
        setPhase(asset === "slides" ? "첨부 장표 업로드" : "강의 영상 업로드"); setProgress(0);
        const parts = completedParts[asset] ?? await uploadMultipart(file, target, setProgress);
        setCompletedParts((previous) => ({ ...previous, [asset]: parts }));
        await api.completeLectureUpload(created.lecture.lectureId, { asset, uploadId: target.uploadId, parts });
        setUploaded((previous) => ({ ...previous, [asset]: true }));
      }
      setPhase("강의 분석 시작");
      await api.startLecture(created.lecture.lectureId);
      await qc.invalidateQueries({ queryKey: ["lectures"] });
      nav(`/lectures/${created.lecture.lectureId}`);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  function chooseVideo(file: File | null) {
    if (file && (!/\.mp4$/i.test(file.name) || file.size > LECTURE_LIMITS.maxVideoBytes)) { setVideo(null); setError("MP4 영상을 선택하세요. 최대 4GB입니다."); return; }
    setVideo(file); setError(""); if (file && !title) setTitle(file.name.replace(/\.mp4$/i, ""));
  }
  function chooseSlides(file: File | null) {
    if (file && (!/\.(pptx|pdf)$/i.test(file.name) || file.size > LECTURE_LIMITS.maxSlidesBytes)) { setSlides(null); setBadSlides(true); setError("PPTX 또는 PDF를 선택하세요. 최대 100MB입니다."); return; }
    setSlides(file); setBadSlides(false); setError("");
  }
  const inputClass = "mt-2 w-full rounded-xl bg-surface border border-line px-3 h-12 text-[16px] focus:outline-none focus:border-accent";
  return <>
    <fieldset disabled={busy || !!plan} className="space-y-5 disabled:opacity-60">
      <Card className="p-4"><label className="block"><span className="flex items-center gap-2 font-semibold"><IconVideo className="text-accent" />강의 영상</span><span className="block mt-1 text-xs text-ink-3">MP4 · 최대 4GB, 4시간, 4K</span><input aria-label="강의 영상" type="file" accept="video/mp4,.mp4" className="block mt-3 w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-3 file:px-3 file:py-2 file:text-ink" onChange={(e) => chooseVideo(e.target.files?.[0] ?? null)} /></label></Card>
      <Card className="p-4"><label className="block"><span className="flex items-center gap-2 font-semibold"><IconStudy className="text-accent" />장표 첨부 <span className="text-xs font-normal text-ink-3">선택</span></span><span className="block mt-1 text-xs text-ink-3">PPTX 또는 PDF · 최대 100MB, 120장</span><input ref={slidesInput} aria-label="강의 장표 (선택)" type="file" accept=".pptx,.pdf" className="block mt-3 w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-3 file:px-3 file:py-2 file:text-ink" onChange={(e) => chooseSlides(e.target.files?.[0] ?? null)} /></label><p className="text-xs text-ink-3 leading-relaxed mt-3">첨부하면 영상 속 화면을 원본 장표와 대조합니다. 장표 없이 영상만 올려도 분석할 수 있습니다.</p>{(slides || badSlides) && <Button variant="ghost" size="sm" className="mt-2" onClick={() => { chooseSlides(null); if (slidesInput.current) slidesInput.current.value = ""; }}>첨부 취소</Button>}</Card>
      <label className="block"><SectionLabel>강의 제목</SectionLabel><input aria-label="강의 제목" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 머신러닝 3주차 — 최적화" className={inputClass} /></label>
      <label className="block"><SectionLabel>과목명 (선택)</SectionLabel><input aria-label="과목명" maxLength={120} value={course} onChange={(e) => setCourse(e.target.value)} placeholder="예: 고급 머신러닝" className={inputClass} /></label>
      <div><SectionLabel>학습 자료 언어</SectionLabel><Segmented className="mt-2" value={language} onChange={setLanguage} options={[{ value: "ko", label: "한국어" }, { value: "en", label: "English" }, { value: "auto", label: "강의 언어" }]} /></div>
      <label className="block"><SectionLabel>영상에서 사용하는 언어</SectionLabel><select aria-label="영상 언어" className={inputClass} value={hint} onChange={(e) => setHint(e.target.value)}><option value="auto">자동 감지</option><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">中文</option></select></label>
    </fieldset>
    {busy && <div className="mt-5" role="status"><p className="text-sm text-ink-2 mb-2">{phase} {progress}%</p><ProgressBar value={progress} /></div>}
    {error && <InlineError>{error}</InlineError>}
    <Button full className="mt-6" loading={busy} disabled={!video || badSlides || !title.trim()} onClick={() => void submit()}>{plan ? "업로드 이어서 진행" : "학습 자료 만들기"}</Button>
    {plan && !busy && <Link className="block text-center text-sm text-ink-3 mt-3" to={`/lectures/${plan.lecture.lectureId}`}>등록된 강의 보기 / 삭제</Link>}
    <p className="mt-3 text-xs text-ink-3 leading-relaxed">업로드가 끝나면 앱을 닫아도 됩니다. 영상의 화면과 발언을 연결해 요약과 복습 자료를 만들고, 관련 논문의 원문 링크를 제공합니다.</p>
  </>;
}
