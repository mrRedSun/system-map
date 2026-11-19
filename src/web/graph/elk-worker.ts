// Browser-only: run ELK in a Web Worker so layout never blocks the page.
import ELK from 'elkjs/lib/elk-api.js';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';

export function createWorkerElk() {
  return new ELK({ workerFactory: () => new Worker(workerUrl) });
}
