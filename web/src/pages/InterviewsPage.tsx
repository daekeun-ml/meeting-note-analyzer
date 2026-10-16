import { usePagedList } from "../lib/use-paged-list";
import { ListPagination } from "../components/ListPagination";
import { useNavigate } from "react-router";
import { INTERVIEW_CRITERION_LABELS } from "@meeting-notes/shared";
import { useApi } from "../lib/api";
import { InterviewStatus, interviewActive } from "../components/InterviewStatus";
import { Button, Card, EmptyState, InlineError, Page, Skeleton, formatDate } from "../components/ui";
import { IconPlus, IconUsers } from "../components/icons";

export function InterviewsPage() {
  const api = useApi(); const nav = useNavigate();
  const pagination = usePagedList("interviews", api.listInterviews, (interview) => interviewActive(interview.status));
  const { query, items, error } = pagination;
  return <Page title="인터뷰 노트" subtitle="질문과 답변을 기록하고, 근거로 평가하기" action={<Button size="sm" icon={<IconPlus size={16} />} onClick={() => nav("/upload?kind=interview")}>새 인터뷰</Button>}>
    {query.isLoading && <Skeleton className="h-28" />}
    {error && <InlineError>{error.message}</InlineError>}
    {!query.isLoading && !error && !items.length && <EmptyState illustration={<IconUsers size={48} className="text-accent" />} title="받아쓰기 대신 면접에 집중하세요" description="MP3를 올리고 평가 항목과 목표 레벨을 선택하세요. 질문·후속 질문·답변을 기록하고 AI 평가 의견을 Markdown으로 저장합니다." action={<Button onClick={() => nav("/upload?kind=interview")}>인터뷰 노트 만들기</Button>} />}
    {!!items.length && <ListPagination label="인터뷰 목록" pagination={pagination} />}
    <div className="space-y-3">{items.map((interview) => <Card key={interview.interviewId} className="p-4" onClick={() => nav(`/interviews/${interview.interviewId}`)}>
      <div className="flex justify-between items-center gap-2"><span className="text-xs text-accent">{interview.settings.targetLevel} · {interview.settings.roleTitle || "인터뷰"}</span><InterviewStatus interview={interview} /></div>
      <h2 className="mt-3 font-semibold text-lg break-words">{interview.title}</h2>
      <p className="mt-2 text-xs text-ink-2 leading-relaxed">{interview.settings.criteria.map((id) => INTERVIEW_CRITERION_LABELS[id]).join(" · ")}</p>
      <p className="mt-2 text-xs text-ink-3">{formatDate(interview.createdAt)}{interview.durationSec ? ` · ${Math.round(interview.durationSec / 60)}분` : ""}</p>
    </Card>)}</div>
    {!!items.length && <ListPagination label="인터뷰 목록" pagination={pagination} bottom />}
  </Page>;
}
