import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Button } from "./ui";

/** Clicking and dropping share the parent's existing file validation. */
export function FilePicker({ label, accept, file, disabled = false, onFile, onError, hint, icon, buttonLabel = "파일 선택" }: {
  label: string; accept: string; file: File | null; disabled?: boolean; onFile: (file: File | null) => void;
  onError: (message: string) => void; hint: string; icon?: ReactNode; buttonLabel?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  function hasFiles(event: DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files") || event.dataTransfer.files.length > 0;
  }
  function drop(event: DragEvent) {
    event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (Array.from(event.dataTransfer.items ?? []).some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
      onError("폴더 대신 파일을 하나씩 선택해 주세요."); return;
    }
    if (!files.length) return;
    if (files.length !== 1) { onError("이 영역에는 파일을 하나씩 놓아 주세요."); return; }
    onFile(files[0]!);
  }
  return <div role="group" aria-label={`${label} 파일 놓기`} aria-disabled={disabled}
    data-drag-active={!disabled && dragging}
    onDragEnter={(event) => { if (!hasFiles(event)) return; event.preventDefault(); if (!disabled) { depth.current++; setDragging(true); } }}
    onDragOver={(event) => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; } }}
    onDragLeave={(event) => { event.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
    onDrop={drop}
    className={`rounded-2xl border-2 border-dashed p-4 transition-colors ${!disabled && dragging ? "border-accent bg-accent-soft" : "border-line-2 bg-surface/60"}`}>
    <label className="flex items-center gap-2 font-semibold">
      {icon}{label}
      <input ref={input} type="file" aria-label={label} accept={accept} disabled={disabled} className="sr-only"
        onChange={(event) => { const selected = event.target.files?.[0]; if (selected) onFile(selected); event.target.value = ""; }} />
    </label>
    <p className="mt-1 text-xs text-ink-3">{hint}</p>
    {file && <div className="mt-3 min-w-0" aria-live="polite"><p className="break-words font-medium text-sm">{file.name}</p><p className="text-xs text-ink-3">{(file.size / 1024 ** 2).toFixed(1)} MB</p></div>}
    <Button type="button" variant="secondary" size="sm" className="mt-3" disabled={disabled} onClick={() => input.current?.click()}>
      {file ? "파일 변경" : buttonLabel}
    </Button>
    <p className="mt-3 text-xs text-ink-3" aria-live="polite">{!disabled && dragging ? "여기에 파일을 놓으세요." : "파일을 이 영역으로 끌어 놓아도 됩니다."}</p>
  </div>;
}
