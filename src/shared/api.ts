/**
 * The JSON API as an Effect `HttpApi`: the server implements it and the web app derives its
 * typed client from it. The two SSE endpoints (`/api/events`, `/api/logs/:host/:container`) are
 * plain routes; their event payloads are the schemas in `model.ts`.
 */
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { ApiErrorBody, HealthResponse, SystemModel, WhoAmI } from './model.js';

export class SystemMapGroup extends HttpApiGroup.make('systemMap', { topLevel: true }).add(
  /** Merged, validated model with derived edges and problems. ETag; 503 until loaded. */
  HttpApiEndpoint.get('model', '/api/model', {
    success: SystemModel,
    error: ApiErrorBody.pipe(HttpApiSchema.status(503)),
  }),
  /** Monitor health from Uptime Kuma, keyed by `kuma_id`; never fails (see `error`). */
  HttpApiEndpoint.get('health', '/api/health', { success: HealthResponse }),
  /** Identity headers from the auth proxy, for display only. */
  HttpApiEndpoint.get('me', '/api/me', { success: WhoAmI }),
) {}

export class SystemMapApi extends HttpApi.make('system-map').add(SystemMapGroup) {}
