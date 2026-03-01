import { state } from './shared.ts';

export class StreamingReplacer {
  buffer = '';
  process(chunk: string) {
    this.buffer += chunk;
    return this.flushSafely();
  }
  flushSafely() {
    let didReplace = true;
    while(didReplace) {
      didReplace = false;
      for (const {fake, original} of state.activeReplacements) {
        if (this.buffer.includes(fake)) {
          this.buffer = this.buffer.split(fake).join(original);
          didReplace = true;
        }
      }
    }

    let safeIdx = this.buffer.length;
    for (const {fake} of state.activeReplacements) {
      for (let i = 1; i < fake.length; i++) {
        if (this.buffer.length >= i) {
          const suffix = this.buffer.slice(-i);
          const prefix = fake.slice(0, i);
          if (suffix === prefix) {
            const possibleSafeIdx = this.buffer.length - i;
            if (possibleSafeIdx < safeIdx) {
              safeIdx = possibleSafeIdx;
            }
          }
        }
      }
    }

    const safeToFlush = this.buffer.slice(0, safeIdx);
    this.buffer = this.buffer.slice(safeIdx);
    return safeToFlush;
  }
  flushAll() {
    // Do one final replacement pass before flushing
    for (const {fake, original} of state.activeReplacements) {
      if (this.buffer.includes(fake)) {
        this.buffer = this.buffer.split(fake).join(original);
      }
    }
    const remaining = this.buffer;
    this.buffer = '';
    return remaining;
  }
}

/**
 * Parse a raw SSE event block into its event type and data line(s).
 * An SSE block can have multiple lines like:
 *   event: delta
 *   data: {"v":[...]}
 * or just:
 *   data: {"type":"message_stream_complete",...}
 */
function parseSSEBlock(block: string): { eventType: string | null; dataLine: string | null; raw: string } {
  const lines = block.split('\n');
  let eventType: string | null = null;
  let dataLine: string | null = null;

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      // Take the first data line we find
      if (dataLine === null) {
        dataLine = line.slice(6);
      }
    }
  }

  return { eventType, dataLine, raw: block };
}


/**
 * Find all "append" delta operations in the ChatGPT v1 delta encoding format.
 * These are objects like: { "o": "append", "v": "some text", "p": "/message/content/parts/0" }
 * They can appear at top level or inside arrays.
 */
function findAppendDeltas(obj: any): Array<{ parent: any; key: string }> {
  const results: Array<{ parent: any; key: string }> = [];

  if (!obj || typeof obj !== 'object') return results;

  // Check if this object itself is an append delta
  if (obj.o === 'append' && typeof obj.v === 'string' && typeof obj.p === 'string' && obj.p.includes('/content/parts/')) {
    results.push({ parent: obj, key: 'v' });
  }

  // Also check for the old-school delta format
  if (obj.delta && typeof obj.delta.content === 'string') {
    results.push({ parent: obj.delta, key: 'content' });
  }
  if (obj.delta && typeof obj.delta.text === 'string') {
    results.push({ parent: obj.delta, key: 'text' });
  }

  // Recurse into arrays and objects
  if (Array.isArray(obj)) {
    for (const item of obj) {
      results.push(...findAppendDeltas(item));
    }
  } else {
    for (const k in obj) {
      if (typeof obj[k] === 'object') {
        results.push(...findAppendDeltas(obj[k]));
      }
    }
  }

  return results;
}

export function handleChatGPTStream(response: Response): Response {
  if (!response.body) return response;
  
  const originalBody = response.body;
  const reader = originalBody.getReader();

  const stream = new ReadableStream({
    async start(controller) {
      let sseBuffer = '';
      const replacer = new StreamingReplacer();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Flush any remaining buffered text
            const finalStr = replacer.flushAll();
            if (finalStr) {
              console.log('[PII Shield] Flushing remaining buffer:', finalStr.length, 'chars');
            }
            if (sseBuffer.trim()) {
              controller.enqueue(new TextEncoder().encode(sseBuffer));
            }
            controller.close();
            break;
          }

          sseBuffer += decoder.decode(value, { stream: true });

          // Split on double-newline to separate SSE event blocks
          const blocks = sseBuffer.split('\n\n');
          sseBuffer = blocks.pop() || '';

          for (const block of blocks) {
            if (!block.trim()) {
              controller.enqueue(new TextEncoder().encode('\n\n'));
              continue;
            }

            const { eventType, dataLine, raw } = parseSSEBlock(block);

            // If there's no data line, pass the block through (e.g. standalone event: lines)
            if (dataLine === null) {
              controller.enqueue(new TextEncoder().encode(`${raw}\n\n`));
              continue;
            }

            // Handle [DONE] signal
            if (dataLine.trim() === '[DONE]') {
              const finalStr = replacer.flushAll();
              if (finalStr) {
                console.log('[PII Shield] Final flush on [DONE]:', finalStr.length, 'chars');
              }
              controller.enqueue(new TextEncoder().encode(`${raw}\n\n`));
              continue;
            }

            // Try to parse JSON
            let data: any;
            try {
              data = JSON.parse(dataLine);
            } catch {
              // Can't parse as JSON → pass through unchanged to preserve Canvas etc.
              controller.enqueue(new TextEncoder().encode(`${raw}\n\n`));
              continue;
            }

            // Find all append delta operations (the streamed text chunks)
            const deltas = findAppendDeltas(data);

            if (deltas.length > 0) {
              // Process each delta through the streaming replacer
              for (const delta of deltas) {
                const chunkStr = delta.parent[delta.key];
                const safeStr = replacer.process(chunkStr);
                delta.parent[delta.key] = safeStr;
              }
              // Only re-serialize if we actually modified content deltas
              const outputLines: string[] = [];
              if (eventType) {
                outputLines.push(`event: ${eventType}`);
              }
              outputLines.push(`data: ${JSON.stringify(data)}`);
              controller.enqueue(new TextEncoder().encode(outputLines.join('\n') + '\n\n'));
            } else {
              // No content deltas — pass the block through UNCHANGED
              // This preserves Canvas, metadata, and other special ChatGPT features
              controller.enqueue(new TextEncoder().encode(`${raw}\n\n`));
            }
          }
        }
      } catch (err) {
        console.error('[PII Shield] Stream processing error:', err);
        controller.error(err);
      }
    },
    cancel(reason) {
      reader.cancel(reason);
    }
  });

  Object.defineProperty(response, 'body', { value: stream });
  return response;
}
