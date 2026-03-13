import express from "express";
import type { Request, Response } from "express";
import { Codex, type ThreadEvent, type ThreadOptions } from "@openai/codex-sdk";

const app = express();
app.use(express.json());

const codex = new Codex({
  apiKey: process.env.OPENAI_API_KEY,
});


const flushIfSupported = (res: Response) => {
  const maybeFlush = res as Response & { flush?: () => void };
  maybeFlush.flush?.();
};

type ChatRequestBody = {
  threadId?: string;
  prompt: string;
  model?: string;
};

app.post("/api/chat/stream", async (req: Request, res: Response) => {
  const { threadId, prompt, model }: ChatRequestBody = req.body || {};
  const effectiveModel = model ?? "gpt-5-codex";

  if (!prompt) {
    res.status(400).json({ error: "Missing 'prompt' in request body" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.socket?.setNoDelay(true);
  res.flushHeaders?.();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    flushIfSupported(res);
  };

  try {
    const threadOptions: ThreadOptions = {
      model: effectiveModel,
      workingDirectory: "./",
      skipGitRepoCheck: true,
      webSearchEnabled: true,
      webSearchMode: "cached",
      sandboxMode:"danger-full-access"
    };

    const thread = threadId
      ? codex.resumeThread(threadId, threadOptions)
      : codex.startThread(threadOptions);

    const { events } = await thread.runStreamed(prompt);
    let threadEventSent = false;

    for await (const event of events) {
      console.log("event : ", event);
      const threadEvent = event as ThreadEvent;

      if (threadEvent.type === "thread.started" && !threadEventSent) {
        sendEvent("thread", { threadId: threadEvent.thread_id });
        threadEventSent = true;
      }

      sendEvent("codex_event", threadEvent);
    }

    if (!threadEventSent && thread.id) {
      sendEvent("thread", { threadId: thread.id });
    }

    res.end();
  } catch (err: unknown) {
    sendEvent("error", {
      message: err instanceof Error ? err.message : "Unknown error",
    });
    res.end();
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use((err: unknown, _req: Request, res: Response, next: (err?: unknown) => void) => {
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: "Request body must be valid JSON." });
    return;
  }
  next(err);
});

const PORT = Number(process.env.PORT ?? 8080);
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
