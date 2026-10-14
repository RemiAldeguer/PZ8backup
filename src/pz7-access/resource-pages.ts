import { useEffect, useRef, useState } from "react";
import {
  AccessApiError,
  isSessionExpired,
  type AccessResource,
  type Pz7AccessClient,
  type ResourceCursor,
  type ResourceFilters,
} from "./client";
interface PageState {
  key: string;
  items: AccessResource[];
  next: ResourceCursor | null;
  loading: boolean;
  loadingMore: boolean;
  error?: unknown;
}
export function useResourcePages(
  client: Pz7AccessClient,
  planzoneId: string,
  filters: ResourceFilters,
  enabled: boolean,
  onUnauthorized: () => void,
) {
  const key = JSON.stringify([
    planzoneId,
    filters.namePrefix,
    filters.type,
    filters.deactivated,
    enabled,
  ]);
  const empty = (): PageState => ({
    key,
    items: [],
    next: null,
    loading: enabled,
    loadingMore: false,
  });
  const [state, setState] = useState<PageState>(empty);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const current = state.key === key ? state : empty();
  useEffect(() => {
    const request = new AbortController();
    const sequence = ++generation.current;
    pending.current = request;
    setState(empty());
    if (!enabled) {
      pending.current = null;
      return () => request.abort();
    }
    void client
      .resources(planzoneId, filters, null, request.signal)
      .then((page) => {
        if (!request.signal.aborted && generation.current === sequence)
          setState({
            key,
            items: page.items,
            next: page.next,
            loading: false,
            loadingMore: false,
          });
      })
      .catch((error) => {
        if (request.signal.aborted || generation.current !== sequence) return;
        setState({ ...empty(), loading: false, error });
        if (isSessionExpired(error)) onUnauthorized();
      })
      .finally(() => {
        if (pending.current === request) pending.current = null;
      });
    return () => {
      generation.current++;
      pending.current?.abort();
      pending.current = null;
    };
  }, [client, key, revision, onUnauthorized]);
  async function loadMore() {
    if (!enabled || !current.next || pending.current) return;
    const sequence = generation.current;
    const request = new AbortController();
    pending.current = request;
    setState((previous) => ({
      ...previous,
      loadingMore: true,
      error: undefined,
    }));
    try {
      const page = await client.resources(
        planzoneId,
        filters,
        current.next,
        request.signal,
      );
      if (request.signal.aborted || generation.current !== sequence) return;
      setState((previous) => ({
        key,
        items: [
          ...new Map(
            [...previous.items, ...page.items].map((item) => [item.id, item]),
          ).values(),
        ],
        next: page.next,
        loading: false,
        loadingMore: false,
      }));
    } catch (error) {
      if (request.signal.aborted || generation.current !== sequence) return;
      setState((previous) => ({
        ...previous,
        ...(error instanceof AccessApiError && [401, 403].includes(error.status)
          ? { items: [], next: null }
          : {}),
        loadingMore: false,
        error,
      }));
      if (isSessionExpired(error)) onUnauthorized();
    } finally {
      if (pending.current === request) pending.current = null;
    }
  }
  return {
    ...current,
    loadMore,
    reload: () => {
      pending.current?.abort();
      generation.current++;
      pending.current = null;
      setState(empty());
      setRevision((value) => value + 1);
    },
  };
}
