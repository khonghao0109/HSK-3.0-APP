'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const TOKEN_HASH = /^#token=([A-Za-z0-9_-]{43})$/;

export type HashLink = {
  /** New for every link read, so a view can remount on a new link. */
  id: number;
  /** The token, or `null` when the fragment is missing or malformed. */
  token: string | null;
};

function createLinkStore() {
  let id = 0;
  let link: (HashLink & { hash: string }) | undefined;
  const read = () => {
    const { hash } = window.location;
    id += 1;
    return { id, hash, token: TOKEN_HASH.exec(hash)?.[1] ?? null };
  };
  return {
    // A fragment-only navigation (another email link opened in this tab)
    // does not remount the page: read the new fragment then.
    subscribe(notify: () => void) {
      const onHashChange = () => {
        if (!window.location.hash) return;
        link = read();
        notify();
      };
      window.addEventListener('hashchange', onHashChange);
      return () => window.removeEventListener('hashchange', onHashChange);
    },
    // Read once and kept, so removing the fragment keeps the snapshot stable.
    get() {
      link ??= read();
      return link;
    },
  };
}

/**
 * Reads `#token=` (the fragment only exists in the browser) and removes any
 * fragment from the URL, so the token leaves neither history nor Referer.
 * `undefined` until read (server render, hydration).
 */
export function useHashToken(): HashLink | undefined {
  const [store] = useState(createLinkStore);
  const link = useSyncExternalStore(
    store.subscribe,
    store.get,
    () => undefined,
  );
  useEffect(() => {
    if (!link?.hash) return;
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', pathname + search);
  }, [link]);
  return link && { id: link.id, token: link.token };
}

/**
 * The view the learner moved to (`null` until they act), and its setter: each
 * move focuses the new view's h1 (pass the returned ref to every h1).
 */
export function useView<V extends string>() {
  const [view, setView] = useState<V | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [view]);
  const go = (next: V) => {
    moved.current = true;
    setView(next);
  };
  return { view, go, heading };
}
