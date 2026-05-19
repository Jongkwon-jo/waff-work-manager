import type { StreamEvent } from "./schemas";

export interface SSEController {
  send: (event: StreamEvent) => void;
  close: () => void;
  abort: (err: unknown) => void;
}

export function createSSEResponse(
  handler: (controller: SSEController) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const send = (event: StreamEvent) => {
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        c.enqueue(encoder.encode(payload));
      };
      const controller: SSEController = {
        send,
        close: () => c.close(),
        abort: (err) => c.error(err),
      };
      try {
        await handler(controller);
      } catch (err) {
        send({
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        try {
          c.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function* readSSE(
  response: Response,
): AsyncGenerator<StreamEvent, void, void> {
  if (!response.body) {
    throw new Error("Response has no body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        yield JSON.parse(raw) as StreamEvent;
      } catch {
        // ignore malformed lines
      }
    }
  }
}
