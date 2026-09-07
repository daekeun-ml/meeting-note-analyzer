export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}
export const env = {
  get tableName() { return requireEnv("TABLE_NAME"); },
  get dataBucket() { return requireEnv("DATA_BUCKET"); },
  get vapidSecretName() { return requireEnv("VAPID_SECRET_NAME"); },
};
