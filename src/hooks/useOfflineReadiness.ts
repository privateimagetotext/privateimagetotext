import { useEffect, useState } from "react";
import { offlineReadiness } from "../lib/offline-readiness";
import { subscribeOfflineLanguageStatus, type OcrLanguageStatus, checkOfflineOcrAssets, subscribeOfflineOcrStatus, subscribeOfflineShellStatus, type OcrModelStatus, type ShellCacheStatus } from "../lib/service-worker";

export function useOfflineShellStatus() {
  const [shell, setShell] = useState<ShellCacheStatus>("checking");
  useEffect(() => subscribeOfflineShellStatus(setShell), []);
  return shell;
}

export function useOfflineLanguageStatus() {
  const [status, setStatus] = useState<OcrLanguageStatus>({ ready: [], preparing: [], failed: false });
  useEffect(() => subscribeOfflineLanguageStatus(setStatus), []);
  return status;
}

export function useOfflineReadiness() {
  const languages = useOfflineLanguageStatus();
  const shell = useOfflineShellStatus();
  const [model, setModel] = useState<OcrModelStatus | null>(null);
  useEffect(() => {
    const unsubscribe = subscribeOfflineOcrStatus(setModel);
    checkOfflineOcrAssets();
    return () => { unsubscribe(); };
  }, []);
  return offlineReadiness(shell, model, languages);
}
