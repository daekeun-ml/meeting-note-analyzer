// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// A stored session as react-oidc-context exposes it on startup: the ID token expired while the app was closed, the
// refresh token is still valid, and isAuthenticated is therefore false.
const auth = vi.hoisted(() => ({ isLoading: false, activeNavigator: undefined as string | undefined, isAuthenticated: false, user: undefined as { expired: boolean; refresh_token?: string } | undefined, error: undefined as Error | undefined, signinSilent: vi.fn(), signinRedirect: vi.fn() }));
vi.mock("react-oidc-context", () => ({ useAuth: () => ({ ...auth }) }));
vi.mock("../use-config", () => ({ useConfig: () => ({ apiBase: "/api" }) }));
import { App } from "../../App";

let root: Root; let element: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  auth.isAuthenticated = false; auth.user = { expired: true, refresh_token: "stored-refresh-token" }; auth.error = undefined;
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });
async function render() { await act(async () => root.render(<MemoryRouter initialEntries={["/meetings/m1"]}><App /></MemoryRouter>)); }
const loginButton = () => [...element.querySelectorAll("button")].find((b) => b.textContent?.includes("이메일과 비밀번호로 로그인"));

it("renews an expired stored session silently instead of showing the login page", async () => {
  let complete!: () => void;
  auth.signinSilent.mockReturnValue(new Promise(resolve => { complete = () => resolve(null); })); // still talking to the token endpoint
  await render();
  expect(element.textContent).toContain("로그인 확인 중");
  expect(loginButton()).toBeUndefined();
  expect(auth.signinSilent).toHaveBeenCalledTimes(1);
  await render(); // re-render must not start a second renewal
  expect(auth.signinSilent).toHaveBeenCalledTimes(1);
  await act(async () => complete());
});
it("falls back to the login page once when the refresh token is rejected", async () => {
  auth.signinSilent.mockRejectedValue(new Error("invalid_grant"));
  await render();
  await vi.waitFor(() => expect(loginButton()).toBeDefined());
  await render();
  expect(auth.signinSilent).toHaveBeenCalledTimes(1);
});
it("shows the login page directly when there is no stored session", async () => {
  auth.user = undefined;
  await render();
  expect(loginButton()).toBeDefined();
  expect(auth.signinSilent).not.toHaveBeenCalled();
});
