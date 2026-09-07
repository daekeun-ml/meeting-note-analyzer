import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useAuth } from "react-oidc-context";
import { LoginPage } from "./pages/LoginPage";
import { MeetingsPage } from "./pages/MeetingsPage";
import { UploadPage } from "./pages/UploadPage";
import { MeetingPage } from "./pages/MeetingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ChatListPage } from "./pages/ChatListPage";
import { ChatPage } from "./pages/ChatPage";
import { LecturesPage } from "./pages/LecturesPage";
// KaTeX ships with the lecture page only; keep it out of the initial bundle.
const LecturePage = lazy(() => import("./pages/LecturePage").then((m) => ({ default: m.LecturePage })));
import { TabBar } from "./components/TabBar";
import { Spinner } from "./components/icons";

/**
 * App shell: a fixed-height flex column whose <main> scrolls internally and whose tab bar is a normal flex child.
 * iOS home-screen (standalone) web apps mis-place `position: fixed; bottom: 0` elements at the top on first launch,
 * so the tab bar must not rely on fixed positioning.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <main className="flex-1 min-h-0 overflow-y-auto safe-top">
        <div className="mx-auto w-full max-w-xl pb-6">{children}</div>
      </main>
      <TabBar />
    </div>
  );
}

export function App() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.isLoading || auth.activeNavigator) {
    return (
      <div className="min-h-dvh grid place-items-center text-ink-3">
        <div className="flex flex-col items-center gap-3"><Spinner size={24} className="text-accent" /><p className="text-sm">로그인 확인 중</p></div>
      </div>
    );
  }
  if (!auth.isAuthenticated) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage error={auth.error?.message} from={location.pathname} />} />
      </Routes>
    );
  }
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<MeetingsPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/lectures" element={<LecturesPage />} />
        <Route path="/lectures/new" element={<Navigate to="/upload?kind=lecture" replace />} />
        <Route path="/lectures/:id" element={<Suspense fallback={<div className="flex justify-center py-16"><Spinner /></div>}><LecturePage /></Suspense>} />
        <Route path="/meetings/:id" element={<MeetingPage />} />
        <Route path="/chat" element={<ChatListPage />} />
        <Route path="/chat/:sessionId" element={<ChatPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/callback" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
