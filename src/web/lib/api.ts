import { useEffect, useState } from 'react';
import type { SystemModel, WhoAmI } from '../../shared/model';

export type Connection = 'connecting' | 'live' | 'reconnecting';

export interface ModelState {
  model?: SystemModel;
  error?: string;
  connection: Connection;
}

/** Loads the model and refetches it (with its ETag) whenever the server says it changed. */
export function useModel(): ModelState {
  const [state, setState] = useState<ModelState>({ connection: 'connecting' });

  useEffect(() => {
    let etag: string | null = null;
    let inflight: AbortController | undefined;
    let closed = false;

    const load = async () => {
      inflight?.abort();
      const ctrl = new AbortController();
      inflight = ctrl;
      try {
        const res = await fetch('/api/model', {
          headers: etag ? { 'If-None-Match': etag } : {},
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (res.status === 304) return;
        if (!res.ok) throw new Error(`Loading the model failed (HTTP ${res.status})`);
        const model = (await res.json()) as SystemModel;
        etag = res.headers.get('ETag');
        if (!closed) setState((s) => ({ ...s, model, error: undefined }));
      } catch (err) {
        if (ctrl.signal.aborted || closed) return;
        setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
      }
    };

    const events = new EventSource('/api/events');
    events.addEventListener('open', () => setState((s) => ({ ...s, connection: 'live' })));
    events.addEventListener('error', () => setState((s) => ({ ...s, connection: 'reconnecting' })));
    events.addEventListener('model', (e) => {
      try {
        const next = (JSON.parse((e as MessageEvent<string>).data) as { etag?: string }).etag;
        if (next !== etag) void load();
      } catch {
        void load();
      }
    });
    void load();

    return () => {
      closed = true;
      inflight?.abort();
      events.close();
    };
  }, []);

  return state;
}

export function useWhoAmI(): WhoAmI {
  const [me, setMe] = useState<WhoAmI>({});
  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<WhoAmI>) : {}))
      .then(setMe)
      .catch(() => setMe({}));
  }, []);
  return me;
}
