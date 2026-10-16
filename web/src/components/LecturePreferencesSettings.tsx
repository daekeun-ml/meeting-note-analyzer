import { useEffect, useRef, useState } from "react";
import { DEFAULT_LECTURE_PREFERENCES, type LecturePreferences } from "@meeting-notes/shared";
import { useApi } from "../lib/api";
import { Button, Card, InlineError } from "./ui";

const choices = {
  model: [["balanced", "Opus 중심 + Sonnet 보조"], ["opus", "모든 작업에 Opus"], ["sonnet", "모든 작업에 Sonnet"]],
  format: [["structured", "제목과 목록으로 구조화"], ["narrative", "문단 중심으로 설명"]],
  tone: [["plain", "담백하고 직접적으로"], ["friendly", "친근하게 풀어서"], ["academic", "학술 용어를 정확하게"]],
  detail: [["brief", "핵심만 짧게"], ["standard", "보통"], ["detailed", "예시와 근거까지 자세히"]],
} as const;
const labels = { model: "강의 분석 모델", format: "응답 형식", tone: "설명 문체", detail: "설명 상세도" };

export function LecturePreferencesSettings() {
  const { getLecturePreferences, saveLecturePreferences } = useApi();
  const [value, setValue] = useState<LecturePreferences>(DEFAULT_LECTURE_PREFERENCES);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const dirty = useRef(false);
  useEffect(() => {
    let active = true;
    setLoaded(false); setError("");
    void getLecturePreferences().then((result) => { if (active) { if (!dirty.current) setValue(result); setLoaded(true); } })
      .catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [getLecturePreferences, retry]);
  async function save() {
    setBusy(true); setError(""); setMessage("");
    try { setValue(await saveLecturePreferences(value)); dirty.current = false; setMessage("강의 기본 설정을 저장했습니다."); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <Card className="mt-6 p-4">
    <h2 className="font-semibold">강의 AI 설정</h2>
    <p className="mt-2 text-xs leading-relaxed text-ink-3">계정에 저장되며 새 강의와 ‘학습 설명 업데이트’에 적용됩니다. 강의별 추가 요청은 설명 방식에서 이 기본값보다 우선합니다.</p>
    <fieldset disabled={!loaded || busy} className="mt-4 space-y-4">
      {(Object.keys(choices) as (keyof LecturePreferences)[]).map((key) => <label className="block text-sm" key={key}>{labels[key]}
        <select aria-label={labels[key]} className="mt-2 h-11 w-full rounded-xl border border-line bg-surface-2 px-3" value={value[key]}
          onChange={(event) => { dirty.current = true; setValue((previous) => ({ ...previous, [key]: event.target.value })); setMessage(""); }}>
          {choices[key].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>)}
      <p className="text-xs text-ink-3">Opus를 더 많이 사용하면 분석 비용과 시간이 늘어날 수 있습니다. 수식 표기와 발언 근거는 모든 설정에서 유지합니다.</p>
      <Button full loading={busy} onClick={() => void save()}>강의 설정 저장</Button>
    </fieldset>
    {!loaded && !error && <p className="mt-3 text-sm" role="status">설정 불러오는 중</p>}
    {error && <><InlineError>{error}</InlineError>{!loaded && <Button size="sm" variant="secondary" className="mt-2" onClick={() => setRetry((n) => n + 1)}>다시 불러오기</Button>}</>}
    {message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
  </Card>;
}
