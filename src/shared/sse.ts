/** Incremental Server-Sent Events parser, used for Dozzle upstream and in the browser. */
export interface SseMessage {
  event?: string;
  data: string;
  id?: string;
}

export class SseParser {
  private buffer = '';
  private data: string[] = [];
  private event: string | undefined;
  private id: string | undefined;

  /** @param maxBuffer guards against an upstream that never sends a newline */
  constructor(private readonly maxBuffer = 1024 * 1024) {}

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];
    const lines = this.buffer.split(/\r\n|\r|\n/);
    this.buffer = lines.pop() ?? '';
    if (this.buffer.length > this.maxBuffer) throw new Error('SSE line too long');
    for (const line of lines) {
      if (line === '') {
        if (this.data.length > 0 || this.event !== undefined) {
          out.push({
            ...(this.event !== undefined ? { event: this.event } : {}),
            data: this.data.join('\n'),
            ...(this.id !== undefined ? { id: this.id } : {}),
          });
        }
        this.data = [];
        this.event = undefined;
        this.id = undefined;
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') this.data.push(value);
      else if (field === 'event') this.event = value;
      else if (field === 'id') this.id = value;
    }
    return out;
  }
}
