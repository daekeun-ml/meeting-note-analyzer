import { useAuth } from "react-oidc-context";
import { LogoMark } from "../components/Logo";
import { IconListChecks, IconSparkles, IconUsers } from "../components/icons";
import { InlineError } from "../components/ui";

const features = [
  { Icon: IconUsers, title: "전사와 화자 식별", text: "CrisperWhisper 전사에 화자를 맥락으로 식별해 이름과 역할을 붙입니다." },
  { Icon: IconListChecks, title: "안건, 요약, F/U", text: "결정 사항, 미결 질문, 담당자와 기한이 정리된 회의록을 만듭니다." },
  { Icon: IconSparkles, title: "AI 제안", text: "안건별 대안과 리스크, 다음 단계를 제안하고 과거 회의와의 충돌을 짚어 줍니다." },
];

export function LoginPage({ error, from }: { error?: string; from: string }) {
  const auth = useAuth();
  return (
    <div className="min-h-dvh glow-bg flex flex-col px-6 safe-top safe-bottom">
      <div className="flex-1 flex flex-col justify-center pt-10">
        <LogoMark size={72} />
        <h1 className="mt-6 text-[30px] font-bold tracking-tight leading-tight">Meeting Notes</h1>
        <p className="mt-2 text-[15px] text-ink-2 leading-relaxed">회의 녹음(mp3)을 올리면 전사부터 회의록, F/U, AI 제안까지 백그라운드에서 만들어 드립니다.</p>
        <ul className="mt-8 space-y-4">
          {features.map(({ Icon, title, text }) => (
            <li key={title} className="flex gap-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 border border-line text-accent"><Icon size={20} /></span>
              <div>
                <p className="text-[15px] font-semibold">{title}</p>
                <p className="text-[13px] text-ink-2 leading-relaxed">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="pb-8">
        <button
          className="tap w-full h-12 rounded-xl bg-white text-[#1f1f1f] font-semibold text-[15px] inline-flex items-center justify-center gap-3 active:scale-[0.98] transition-transform shadow-card"
          onClick={() => void auth.signinRedirect({ state: { from } })}
        >
          이메일과 비밀번호로 로그인
        </button>
        {error && <InlineError>{error}</InlineError>}
        <p className="mt-4 text-center text-xs text-ink-3">관리자가 생성한 계정으로 로그인하세요.</p>
      </div>
    </div>
  );
}
