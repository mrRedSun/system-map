/** Typed client for the JSON API, derived from the shared `HttpApi` definition. */
import { FetchHttpClient } from 'effect/http';
import { AtomHttpApi } from 'effect/reactivity';
import { SystemMapApi } from '../../shared/api';

export class ApiClient extends AtomHttpApi.Service<ApiClient>()('system-map/ApiClient', {
  api: SystemMapApi,
  // The browser's HTTP cache revalidates `/api/model` with its ETag (the server sends no-cache).
  httpClient: FetchHttpClient.layer,
  baseUrl: typeof location === 'undefined' ? 'http://localhost/' : location.origin,
}) {}

export function errorText(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const e = err as { error?: unknown; message?: unknown };
    if (typeof e.error === 'string') return e.error;
    if (typeof e.message === 'string' && e.message) return e.message;
  }
  return String(err);
}
