import { useCallback, useState } from "react";
import type { Cursor, ScopePage, ScopeQuery } from "../client";
import { useRemote } from "./async";

/** One bounded page at a time, with retained cursors, never the whole organisation. */
export function usePaged<T>(key: string, load: (signal: AbortSignal, query: ScopeQuery) => Promise<ScopePage<T>>, onUnauthorized: () => void) {
  const [navigation, setNavigation] = useState<{ key: string; prefix: string; cursors: Array<Cursor | undefined> }>({ key, prefix: "", cursors: [undefined] });
  const { prefix, cursors } = navigation.key === key ? navigation : { prefix: "", cursors: [undefined] };
  const after = cursors[cursors.length - 1];
  const read = useCallback((signal: AbortSignal) => load(signal, { namePrefix: prefix, after, limit: 25 }), [load, prefix, after]);
  const remote = useRemote(key + JSON.stringify({ prefix, after }), read, onUnauthorized);
  function search(value: string) { setNavigation({ key, prefix: value, cursors: [undefined] }); }
  function next() { if (remote.data?.next) setNavigation({ key, prefix, cursors: [...cursors, remote.data.next] }); }
  function previous() { setNavigation({ key, prefix, cursors: cursors.length > 1 ? cursors.slice(0, -1) : cursors }); }
  return { ...remote, prefix, search, next, previous, hasPrevious: cursors.length > 1 };
}

export function Pagination({ count, hasNext, hasPrevious, next, previous }: { count: number; hasNext: boolean; hasPrevious: boolean; next: () => void; previous: () => void }) {
  return <div className="ps-pagination"><span role="status">{count} ligne{count === 1 ? "" : "s"} chargée{count === 1 ? "" : "s"} sur cette page</span>
    {hasPrevious && <button type="button" onClick={previous}>Page précédente</button>}
    {hasNext && <button type="button" onClick={next}>Charger la suite</button>}
  </div>;
}
