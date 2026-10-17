import type { AudioProcessingOptions } from "@meeting-notes/shared";

export function AudioProcessingSettings({ value, onChange, disabled = false }: {
  value: AudioProcessingOptions; onChange: (value: AudioProcessingOptions) => void; disabled?: boolean;
}) {
  const options = [
    ["denoise", "잡음 감소", "잡음을 줄인 음성을 전사, 화자 분리와 다운로드에 사용합니다. 적용이 어렵거나 처리에 실패하면 원본 음성을 사용합니다."],
    ["trim", "확실한 앞뒤 잡담 제외", "명확한 시작 또는 종료 근거가 있는 주변 대화만 분석에서 제외합니다."],
    ["terminology", "전문용어 표기 교정", "AWS, ML, 면접 용어의 알려진 표기 변형을 사전과 대조합니다."],
  ] as const;
  return <details className="mt-5 rounded-xl border border-line bg-surface p-4 text-sm">
    <summary className="cursor-pointer font-semibold">음성 전처리 설정</summary>
    <p className="mt-3 text-xs text-ink-3">원본 파일과 음성 인식 원문은 보존합니다. 애매한 구간이나 비슷하기만 한 용어는 자동으로 바꾸지 않습니다.</p>
    <fieldset disabled={disabled} className="mt-3 space-y-3">
      {options.map(([key, label, hint]) => <label key={key} className="flex items-start gap-3">
        <input type="checkbox" aria-label={label} checked={value[key]} className="mt-1"
          onChange={(event) => onChange({ ...value, [key]: event.target.checked })} />
        <span>{label}<span className="mt-1 block text-xs leading-relaxed text-ink-3">{hint}</span></span>
      </label>)}
    </fieldset>
  </details>;
}
