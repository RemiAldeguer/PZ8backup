import { useCallback, useEffect, useRef, useState } from "react";

export function errorDetails(error: unknown): { status?: number; code?: string } {
  return error && typeof error === "object" ? error : {};
}

export function useRemote<T>(key: string, load: (signal: AbortSignal) => Promise<T>, onUnauthorized: () => void) {
  const [state, setState] = useState<{ key: string; load: typeof load; loading: boolean; data?: T; error?: unknown }>({ key, load, loading: true });
  const [revision, setRevision] = useState(0);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, load, loading: true });
    void Promise.resolve().then(() => load(controller.signal)).then(data => {
      if (!controller.signal.aborted) setState({ key, load, loading: false, data });
    }).catch(error => {
      if (controller.signal.aborted) return;
      setState({ key, load, loading: false, error });
      if (errorDetails(error).status === 401 || errorDetails(error).code === "SESSION_EXPIRED") unauthorized.current();
    });
    return () => controller.abort();
  }, [key, load, revision]);
  const reload = useCallback(() => {
    setState({ key, load, loading: true });
    setRevision(value => value + 1);
  }, [key, load]);
  const visible: typeof state = state.key === key && state.load === load ? state : { key, load, loading: true };
  return { ...visible, reload };
}

export function useAction(onUnauthorized: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); };
  }, []);
  async function run(action: (signal: AbortSignal) => Promise<unknown>, done: () => void) {
    if (controller.current || !active.current) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError(undefined);
    try {
      await action(current.signal);
      if (active.current && !current.signal.aborted) done();
    } catch (error) {
      if (active.current && !current.signal.aborted) {
        setError(error);
        if (errorDetails(error).status === 401 || errorDetails(error).code === "SESSION_EXPIRED") unauthorized.current();
      }
    } finally {
      if (controller.current === current) {
        controller.current = null;
        if (active.current) setBusy(false);
      }
    }
  }
  return { busy, error, run };
}
