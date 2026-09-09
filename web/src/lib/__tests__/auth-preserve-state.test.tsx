// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { AuthProvider } from 'react-oidc-context';
import { User, UserManager } from 'oidc-client-ts';
import { expect, it, vi } from 'vitest';
vi.mock('../use-config', () => ({ useConfig: () => ({ apiBase: '/api' }) }));
vi.mock('../../pages/MeetingsPage', async () => {
  const { useState } = await import('react');
  const { useApi } = await import('../api');
  return { MeetingsPage: function Probe() {
    const [draft, setDraft] = useState(''); const api = useApi();
    return <div><textarea value={draft} readOnly /><button onClick={() => setDraft('저장 전 제목')}>edit</button><button onClick={() => { void api.me().catch(() => {}); }}>request</button></div>;
  } };
});
import { App } from '../../App';

it('keeps the current component tree and draft during a real AuthProvider 401 renewal', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const user = new User({ id_token: 'stale-id-token', access_token: 'access-token', refresh_token: 'refresh', token_type: 'Bearer', expires_at: Math.floor(Date.now()/1000)+600, profile: { sub: 'u1', iss: 'https://example.test', aud: 'test', exp: Math.floor(Date.now()/1000)+600, iat: Math.floor(Date.now()/1000) } });
  const manager = new UserManager({ authority: 'https://example.test', client_id: 'test', redirect_uri: 'http://localhost/callback', automaticSilentRenew: false });
  vi.spyOn(manager, 'getUser').mockResolvedValue(user);
  let complete!: (value: User) => void;
  vi.spyOn(manager, 'signinSilent').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 401 })).mockResolvedValueOnce(new Response('{"sub":"u1"}', { status: 200 })));
  const element = document.createElement('div'); document.body.appendChild(element); const root = createRoot(element);
  try {
    await act(async () => root.render(<AuthProvider userManager={manager}><MemoryRouter><App /></MemoryRouter></AuthProvider>));
    const click = (text: string) => [...element.querySelectorAll('button')].find(b=>b.textContent===text)!.click();
    await act(async () => click('edit'));
    expect(element.querySelector('textarea')!.value).toBe('저장 전 제목');
    await act(async () => click('request'));
    expect(manager.signinSilent).toHaveBeenCalledTimes(1);
    expect(element.textContent).not.toContain('로그인 확인 중');
    expect(element.querySelector('textarea')!.value).toBe('저장 전 제목');
    await act(async () => complete(user));
    expect(element.querySelector('textarea')!.value).toBe('저장 전 제목');
  } finally {
    await act(async () => root.unmount()); manager.stopSilentRenew(); element.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  }
});
