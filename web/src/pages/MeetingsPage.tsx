import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { ACTIVE_STATUSES, STAGES, type MeetingDto } from "@meeting-notes/shared";
import { useApi } from "../lib/api";
import { StatusChip } from "../components/StatusChip";
import { EmptyIllustration } from "../components/Logo";
import { IconChevronRight, IconClock, IconPlus, IconUsers } from "../components/icons";
import { Button, Card, EmptyState, InlineError, Page, ProgressBar, Skeleton, formatDate, formatDuration } from "../components/ui";
import { STAGE_LABELS } from "../components/StageProgress";

export function MeetingsPage() {
  const api = useApi();
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["meetings"],
    queryFn: () => api.listMeetings(),
    refetchInterval: (query) => (query.state.data?.items.some((m) => ACTIVE_STATUSES.includes(m.status)) ? 8_000 : false),
  });
  return (
    <Page title="회의" subtitle={q.data ? `${q.data.items.length}개의 회의` : undefined} action={<Button size="sm" icon={<IconPlus size={16} strokeWidth={2.25} />} onClick={() => nav("/upload")}>업로드</Button>}>
      {q.isLoading && <div className="space-y-3"><Skeleton className="h-[92px]" /><Skeleton className="h-[92px]" /><Skeleton className="h-[92px]" /></div>}
      {q.error && <InlineError>{String((q.error as Error).message)}</InlineError>}
      {q.data && q.data.items.length === 0 && (
        <EmptyState
          illustration={<EmptyIllustration />}
          title="아직 회의가 없습니다"
          description="첫 회의 녹음(mp3)을 올려 보세요. 전사와 분석은 서버에서 이어지고, 끝나면 알려 드립니다."
          action={<Button icon={<IconPlus size={18} strokeWidth={2.25} />} onClick={() => nav("/upload")}>회의 업로드</Button>}
        />
      )}
      <ul className="space-y-3">
        {q.data?.items.map((m) => (
          <li key={m.meetingId}>
            <MeetingRow m={m} />
          </li>
        ))}
      </ul>
    </Page>
  );
}

function MeetingRow({ m }: { m: MeetingDto }) {
  const active = ACTIVE_STATUSES.includes(m.status);
  const all = ["stt", ...STAGES];
  const done = all.filter((s) => (m.stages as Record<string, { status?: string } | undefined>)[s]?.status === "COMPLETED").length;
  return (
    <Link to={`/meetings/${m.meetingId}`} className="block">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-semibold text-[16px] leading-snug line-clamp-2">{m.title}</h2>
          <StatusChip status={m.status} />
        </div>
        <div className="mt-2 flex items-center gap-3 text-[12px] text-ink-3">
          <span>{formatDate(m.createdAt)}</span>
          {m.durationSec ? <span className="inline-flex items-center gap-1"><IconClock size={13} />{formatDuration(m.durationSec)}</span> : null}
          {m.speakerCount ? <span className="inline-flex items-center gap-1"><IconUsers size={13} />{m.speakerCount}명</span> : null}
          <IconChevronRight size={16} className="ml-auto text-ink-3" />
        </div>
        {active && (
          <div className="mt-3">
            <ProgressBar value={(done / all.length) * 100} />
            <p className="mt-1.5 text-[12px] text-accent">{m.currentStage ? `${STAGE_LABELS[m.currentStage] ?? m.currentStage} 진행 중` : "대기 중"}</p>
          </div>
        )}
        {m.status === "FAILED" && m.error && <p className="mt-2 text-[12px] text-danger line-clamp-2">{m.error}</p>}
      </Card>
    </Link>
  );
}
