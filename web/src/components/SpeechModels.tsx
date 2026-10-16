import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_SPEECH_MODELS, DIARIZATION_MODELS, LEGACY_SPEECH_MODELS, STT_MODELS, type SpeechModels } from "@meeting-notes/shared";
import { useApi } from "../lib/api";
import { Button, Card, InlineError } from "./ui";

export function SpeechModelFields({ value, onChange, disabled = false }: {
  value: SpeechModels; onChange: (value: SpeechModels) => void; disabled?: boolean;
}) {
  const stt = STT_MODELS.find((item) => item.id === value.stt)!;
  const diarization = DIARIZATION_MODELS.find((item) => item.id === value.diarization)!;
  return <fieldset disabled={disabled} className="space-y-4">
    <label className="block text-sm">음성 인식 모델
      <select aria-label="음성 인식 모델" value={value.stt}
        className="mt-2 h-11 w-full rounded-xl border border-line bg-surface-2 px-3"
        onChange={(event) => onChange({ ...value, stt: event.target.value as SpeechModels["stt"] })}>
        {STT_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <span className="mt-2 block text-xs leading-relaxed text-ink-3">{stt.description}</span>
    </label>
    {value.stt === "crisperwhisper" && <p className="text-xs text-ink-3">CrisperWhisper는 연구 및 비상업용 라이선스이며 상업 이용에는 별도 계약이 필요합니다.</p>}
    <label className="block text-sm">화자 분리 모델
      <select aria-label="화자 분리 모델" value={value.diarization}
        className="mt-2 h-11 w-full rounded-xl border border-line bg-surface-2 px-3"
        onChange={(event) => onChange({ ...value, diarization: event.target.value as SpeechModels["diarization"] })}>
        {DIARIZATION_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <span className="mt-2 block text-xs leading-relaxed text-ink-3">{diarization.description}</span>
    </label>
  </fieldset>;
}

/** Do not overwrite a manual choice, or the selection fixed by an existing upload plan. */
export function useSpeechModelChoice(locked: boolean) {
  const api = useApi();
  const query = useQuery({ queryKey: ["speech-preferences"], queryFn: () => api.getSpeechPreferences(), retry: false });
  const [value, setValue] = useState<SpeechModels>(query.data ?? DEFAULT_SPEECH_MODELS);
  const dirty = useRef(false);
  useEffect(() => {
    if (query.data && !dirty.current && !locked) setValue(query.data);
  }, [query.data, locked]);
  return { value, change: (next: SpeechModels) => { dirty.current = true; setValue(next); },
    loading: query.isPending, error: query.error, reload: () => void query.refetch() };
}

export function UploadSpeechModels({ choice, disabled }: { choice: ReturnType<typeof useSpeechModelChoice>; disabled: boolean }) {
  return <Card className="mt-5 p-4">
    <h2 className="mb-4 font-semibold">전사와 화자 분리</h2>
    <SpeechModelFields value={choice.value} onChange={choice.change} disabled={disabled || choice.loading} />
    {choice.loading && <p className="mt-3 text-xs text-ink-3">음성 모델 설정을 불러오는 중입니다.</p>}
    {choice.error && <p className="mt-3 text-xs text-warning">저장된 기본 설정을 불러오지 못했습니다. 표시된 모델로 진행하거나 <button className="underline" onClick={choice.reload}>다시 불러오기</button>를 선택하세요.</p>}
  </Card>;
}

export function SpeechPreferencesSettings() {
  const api = useApi(), cache = useQueryClient();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const choice = useSpeechModelChoice(busy);
  async function save() {
    setBusy(true); setMessage(""); setError("");
    try {
      const result = await api.saveSpeechPreferences(choice.value);
      cache.setQueryData(["speech-preferences"], result);
      setMessage("음성 모델 기본 설정을 저장했습니다.");
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <Card className="mt-6 p-4">
    <h2 className="font-semibold">음성 모델 설정</h2>
    <p className="mt-2 text-xs leading-relaxed text-ink-3">새 회의, 강의, 인터뷰 업로드에 적용됩니다. 업로드할 때 다른 모델을 선택할 수 있으며, 기존 기록의 전사는 유지합니다.</p>
    <div className="mt-4"><SpeechModelFields value={choice.value} onChange={choice.change} disabled={choice.loading || busy} /></div>
    <Button full className="mt-4" disabled={choice.loading} loading={busy} onClick={() => void save()}>음성 모델 설정 저장</Button>
    {(error || choice.error) && <InlineError>{error || choice.error?.message}<button className="ml-2 underline" onClick={choice.reload}>다시 불러오기</button></InlineError>}
    {message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
  </Card>;
}

export function SpeechModelSummary({ selection }: { selection?: SpeechModels }) {
  const models = selection ?? LEGACY_SPEECH_MODELS;
  return <p className="mt-3 text-xs leading-relaxed text-ink-3">
    전사: {STT_MODELS.find((item) => item.id === models.stt)?.label},
    {" "}화자 분리: {DIARIZATION_MODELS.find((item) => item.id === models.diarization)?.label}
  </p>;
}
