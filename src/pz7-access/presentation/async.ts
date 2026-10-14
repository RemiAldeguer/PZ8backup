import type { OperationIds } from "../application/ports";
import { createOperationId } from "../application/operation-id";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSessionExpired } from "../application/errors";

interface RemoteState<T> {
  key: string;
  loading: boolean;
  data?: T;
  error?: unknown;
}
export function useRemote<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  onUnauthorized?: () => void,
) {
  const [state, setState] = useState<RemoteState<T>>({ key, loading: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, loading: true });
    void load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, loading: false, data });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ key, loading: false, error });
        if (isSessionExpired(error)) onUnauthorized?.();
      });
    return () => controller.abort();
  }, [key, load, revision, onUnauthorized]);
  return {
    ...(state.key === key ? state : { key, loading: true }),
    reload: useCallback(() => {
      setState({ key, loading: true });
      setRevision((value) => value + 1);
    }, [key]),
  };
}
/** Mutation completion cannot populate a component belonging to a previous Planzone. */
export function useAction(onUnauthorized?: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  async function run<T>(
    action: (signal: AbortSignal) => Promise<T>,
    completed: (result: T) => void,
  ) {
    if (controller.current || !mounted.current) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError(undefined);
    try {
      const result = await action(current.signal);
      if (mounted.current && !current.signal.aborted) completed(result);
    } catch (error) {
      if (mounted.current && !current.signal.aborted) {
        setError(error);
        if (isSessionExpired(error)) onUnauthorized?.();
      }
    } finally {
      if (controller.current === current) controller.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  return { busy, error, run, clearError: () => setError(undefined) };
}
/** The application assigns IDs; React owns only this form's lifetime. */
export function useOperationId(ids: OperationIds) {
  return useMemo(() => createOperationId(ids), [ids]);
}
