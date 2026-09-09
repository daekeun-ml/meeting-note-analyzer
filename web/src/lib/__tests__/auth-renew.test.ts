import { expect, it, vi } from "vitest";
import type { User } from "oidc-client-ts";
import { renewSession } from "../auth-renew";

it("shares one renewal across concurrent callers and permits a later renewal", async () => {
  let complete!: (user: User) => void;
  const signin = vi.fn(() => new Promise<User>(resolve => { complete = resolve; }));
  const first = renewSession(signin), second = renewSession(signin);
  expect(first).toBe(second);
  await Promise.resolve();
  expect(signin).toHaveBeenCalledTimes(1);
  const user = { id_token: "fresh" } as User;
  complete(user);
  expect(await first).toBe(user);
  const next = renewSession(signin); await Promise.resolve();
  expect(signin).toHaveBeenCalledTimes(2); complete(user); await next;
});
it("clears rejected renewals so the next attempt is not stuck on an old failure", async () => {
  const signin = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(null);
  await expect(renewSession(signin)).rejects.toThrow("network");
  expect(await renewSession(signin)).toBeNull();
  expect(signin).toHaveBeenCalledTimes(2);
});
