import { createContext, useContext } from "react";
import type { AppConfig } from "../config";

export const ConfigContext = createContext<AppConfig | null>(null);

export function useConfig(): AppConfig {
  const cfg = useContext(ConfigContext);
  if (!cfg) throw new Error("config not loaded");
  return cfg;
}
