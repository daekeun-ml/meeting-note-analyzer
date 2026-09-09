import type { AuthContextProps } from "react-oidc-context";

type SigninSilent = AuthContextProps["signinSilent"];
const pending = new WeakMap<SigninSilent, ReturnType<SigninSilent>>();

/** Share one refresh across startup, concurrent API requests and StrictMode effects. */
export function renewSession(signinSilent: SigninSilent): ReturnType<SigninSilent> {
  const current = pending.get(signinSilent);
  if (current) return current;
  const refresh = Promise.resolve().then(() => signinSilent()).finally(() => pending.delete(signinSilent));
  pending.set(signinSilent, refresh);
  return refresh;
}
