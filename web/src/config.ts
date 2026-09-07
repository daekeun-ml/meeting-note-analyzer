export interface AppConfig {
  cognitoAuthority: string;
  cognitoClientId: string;
  cognitoDomain: string;
  apiBase: string;
  appOrigin: string;
}

export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch("/config.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`config.json ${res.status}`);
  return (await res.json()) as AppConfig;
}
