import { useMemo, useState } from "react";
import type { MindMap, MindMapNode, MindMapNodeKind } from "@meeting-notes/shared";
import { Card, SectionLabel } from "./ui";

interface Laid {
  node: MindMapNode;
  depth: number;
  children: Laid[];
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
}

const COL = 168;
const MAX_W = 176;
const PAD = 9;
const LINE = 14;
const GAP = 8;
const FONT = 12;
const LEFT = 22;
const ROOT_H = 36;

const KIND: Record<MindMapNodeKind, { label: string; color: string }> = {
  root: { label: "회의", color: "var(--color-ink)" },
  agenda: { label: "안건", color: "var(--color-accent)" },
  topic: { label: "주제", color: "var(--color-ink-2)" },
  decision: { label: "결정", color: "var(--color-success)" },
  question: { label: "미결", color: "var(--color-warning)" },
  followup: { label: "F/U", color: "var(--color-violet)" },
  risk: { label: "리스크", color: "var(--color-danger)" },
  suggestion: { label: "제안", color: "#5cc8e0" },
  note: { label: "메모", color: "var(--color-ink-3)" },
};

const isWide = (ch: string) => /[ᄀ-ᇿ㄰-㆏가-힯　-〿぀-ヿ一-鿿＀-￯]/.test(ch);
const textWidth = (s: string) => Array.from(s).reduce((w, ch) => w + (isWide(ch) ? FONT * 1.02 : /[A-Z0-9]/.test(ch) ? FONT * 0.66 : FONT * 0.56), 0);

/** Wrap a label into at most two lines that fit MAX_W; the second line is truncated with "..." when needed. */
function wrap(label: string): { lines: string[]; w: number; h: number } {
  const limit = MAX_W - PAD * 2;
  const words = label.split(" ");
  const lines: string[] = [];
  let cur = "";
  const push = (piece: string) => {
    const next = cur ? `${cur} ${piece}` : piece;
    if (textWidth(next) <= limit) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = piece;
      while (textWidth(cur) > limit && lines.length < 1) {
        let head = cur;
        while (textWidth(head) > limit && head.length > 1) head = head.slice(0, -1);
        lines.push(head);
        cur = cur.slice(head.length);
      }
    }
  };
  for (const w of words) push(w);
  if (cur) lines.push(cur);
  if (lines.length > 2) {
    let last = `${lines[1]!} ${lines.slice(2).join(" ")}`;
    while (textWidth(`${last}...`) > limit && last.length > 1) last = last.slice(0, -1);
    lines.length = 2;
    lines[1] = `${last.trimEnd()}...`;
  } else if (lines.length === 2 && textWidth(lines[1]!) > limit) {
    let last = lines[1]!;
    while (textWidth(`${last}...`) > limit && last.length > 1) last = last.slice(0, -1);
    lines[1] = `${last.trimEnd()}...`;
  }
  const w = Math.max(64, Math.ceil(Math.max(...lines.map(textWidth)) + PAD * 2));
  return { lines, w, h: lines.length * LINE + 12 };
}

function layout(nodes: MindMapNode[]): { root: MindMapNode | null; branches: Laid[]; all: Laid[]; width: number; height: number } {
  const byParent = new Map<string, MindMapNode[]>();
  let rootNode: MindMapNode | undefined;
  for (const n of nodes) {
    if (!n.parentId) rootNode ??= n;
    else byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n]);
  }
  if (!rootNode) return { root: null, branches: [], all: [], width: 0, height: 0 };
  const all: Laid[] = [];
  const seen = new Set<string>([rootNode.id]);
  let cursor = ROOT_H + 18;
  // Depth-first: leaves consume vertical space, parents center on their children (the root is drawn as a header bar).
  const build = (n: MindMapNode, depth: number): Laid => {
    seen.add(n.id);
    const { lines, w, h } = wrap(n.label);
    const laid: Laid = { node: n, depth, children: [], x: LEFT + depth * COL, y: 0, w, h, lines };
    const kids = (byParent.get(n.id) ?? []).filter((k) => !seen.has(k.id));
    const top = cursor;
    if (kids.length === 0) {
      cursor += h + GAP;
    } else {
      laid.children = kids.map((k) => build(k, depth + 1));
      if (cursor - top < h + GAP) cursor = top + h + GAP;
    }
    laid.y = (top + cursor - GAP) / 2;
    all.push(laid);
    return laid;
  };
  const branches = (byParent.get(rootNode.id) ?? []).map((k) => build(k, 0));
  const width = Math.max(...all.map((l) => l.x + l.w), 200) + 12;
  return { root: rootNode, branches, all, width, height: cursor + 4 };
}

export function MindMapView({ map }: { map: MindMap }) {
  const { root, branches, all, width, height } = useMemo(() => layout(map.nodes), [map.nodes]);
  const [showFindings, setShowFindings] = useState(false);
  const kindsUsed = Array.from(new Set(map.nodes.map((n) => n.kind))).filter((k) => k !== "root");
  const c = map.coverage;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3 mb-3">
        <span className={map.review.verdict === "pass" ? "text-success" : "text-warning"}>{map.review.verdict === "pass" ? "검토 통과" : "검토 후 수정"}</span>
        {c && <span>반영률: 안건 {Math.round(c.agenda * 100)}%, F/U {Math.round(c.followUps * 100)}%, 결정 {Math.round(c.decisions * 100)}%</span>}
        <span>{map.nodes.length}개 노드</span>
        {map.review.findings.length > 0 && (
          <button className="tap text-accent" onClick={() => setShowFindings((v) => !v)}>검토 의견 {map.review.findings.length}건 {showFindings ? "접기" : "보기"}</button>
        )}
      </div>
      {showFindings && (
        <Card className="p-4 mb-3">
          <SectionLabel>검토 의견</SectionLabel>
          <ul className="mt-2 space-y-1.5 text-[13px] text-ink-2">{map.review.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </Card>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3 mb-2">
        {kindsUsed.map((k) => (
          <span key={k} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: KIND[k].color }} />{KIND[k].label}</span>
        ))}
      </div>
      <div className="overflow-auto rounded-2xl border border-line bg-surface p-2" style={{ maxHeight: "72vh" }}>
        {root && (
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block" role="img" aria-label="회의 마인드맵">
            <rect x={0} y={0} width={width - 12} height={ROOT_H} rx={10} fill="var(--color-accent)" />
            <text x={12} y={ROOT_H / 2 + 4} fontSize={13} fontWeight={700} fill="#fff">{wrap(root.label).lines[0]}</text>
            {branches.length > 0 && <path d={`M 12 ${ROOT_H} V ${branches[branches.length - 1]!.y}`} stroke="var(--color-accent)" strokeOpacity={0.6} strokeWidth={1.5} fill="none" />}
            {branches.map((b) => <path key={`trunk-${b.node.id}`} d={`M 12 ${b.y} H ${LEFT}`} stroke="var(--color-accent)" strokeOpacity={0.6} strokeWidth={1.5} fill="none" />)}
            {all.map((l) =>
              l.children.map((k) => (
                <path key={`${l.node.id}-${k.node.id}`} d={`M ${l.x + l.w} ${l.y} C ${l.x + l.w + 28} ${l.y}, ${k.x - 28} ${k.y}, ${k.x} ${k.y}`} fill="none" stroke={KIND[k.node.kind].color} strokeOpacity={0.55} strokeWidth={1.5} />
              )),
            )}
            {all.map((l) => {
              const color = KIND[l.node.kind].color;
              const agenda = l.node.kind === "agenda";
              return (
                <g key={l.node.id} transform={`translate(${l.x}, ${l.y - l.h / 2})`}>
                  <title>{l.node.label}</title>
                  <rect width={l.w} height={l.h} rx={8} fill={agenda ? "var(--color-accent-soft)" : "var(--color-surface-2)"} stroke={color} strokeOpacity={agenda ? 0.9 : 0.6} />
                  {!agenda && <rect x={0} y={6} width={3} height={l.h - 12} rx={1.5} fill={color} />}
                  {l.lines.map((line, i) => (
                    <text key={i} x={PAD + (agenda ? 0 : 3)} y={12 + LINE * i + 5} fontSize={FONT} fontWeight={agenda ? 600 : 500} fill="var(--color-ink)">{line}</text>
                  ))}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      {root && (
        <Card className="p-4 mt-3">
          <SectionLabel>개요 목록</SectionLabel>
          <p className="mt-2 py-1 text-[13.5px] font-semibold">{root.label}</p>
          {branches.map((b) => <Outline key={b.node.id} node={b} />)}
        </Card>
      )}
    </div>
  );
}

function Outline({ node }: { node: Laid }) {
  const color = KIND[node.node.kind].color;
  return (
    <div className="pl-3 border-l border-line ml-1">
      <p className={`py-1 text-[13.5px] leading-snug ${node.depth === 0 ? "font-semibold" : "text-ink-2"}`}>
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: color }} />
        {node.node.label}
      </p>
      {node.children.map((k) => <Outline key={k.node.id} node={k} />)}
    </div>
  );
}
