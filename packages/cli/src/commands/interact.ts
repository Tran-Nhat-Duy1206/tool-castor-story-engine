import { Command } from "commander";
import {
  PipelineRunner,
  runAgentSession,
} from "@actalk/castor-core";
import { buildPipelineConfig, createClient, findProjectRoot, loadConfig } from "../utils.js";

export interface InteractCommandHooks {
  readonly readInput?: () => Promise<string>;
}

async function readInteractionInput(
  args: ReadonlyArray<string>,
  explicitMessage: string | undefined,
  readInput?: () => Promise<string>,
): Promise<string> {
  const explicit = explicitMessage?.trim();
  if (explicit) {
    return explicit;
  }

  const inline = args.join(" ").trim();
  if (inline) {
    return inline;
  }

  if (readInput) {
    const provided = (await readInput()).trim();
    if (provided) {
      return provided;
    }
  }

  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const piped = Buffer.concat(chunks).toString("utf-8").trim();
    if (piped) {
      return piped;
    }
  }

  throw new Error("Interaction message is required. Pass text arguments or pipe input via stdin.");
}

export function createInteractCommand(hooks: InteractCommandHooks = {}): Command {
  return new Command("interact")
    .description("Run a natural-language agent interaction against the current project")
    .argument("[message...]", "Natural-language message")
    .option("--message <text>", "Explicit natural-language message")
    .option("--book <bookId>", "Bind a specific active book for this interaction")
    .option("--session <sessionId>", "Reuse an agent session id")
    .option("--json", "Emit structured JSON for external agents")
    .action(async (messageArgs: ReadonlyArray<string>, opts) => {
      const input = await readInteractionInput(messageArgs, opts.message, hooks.readInput);
      const projectRoot = findProjectRoot();
      const config = await loadConfig({ requireApiKey: false, projectRoot });
      const client = createClient(config);
      const bookId = typeof opts.book === "string" && opts.book.trim() ? opts.book.trim() : null;
      const trimmed = input.trim();
      const actionSource = trimmed.startsWith("/") ? "slash" : "free-text";
      const requestedIntent = bookId && trimmed === "/write"
        ? "write_next"
        : !bookId && trimmed === "/create"
          ? "create_book"
          : undefined;
      const sessionKind = bookId
        ? "book"
        : requestedIntent === "create_book"
          ? "book-create"
          : "chat";
      const sessionId = typeof opts.session === "string" && opts.session.trim()
        ? opts.session.trim()
        : `cli-interact-${Date.now().toString(36)}`;
      const pipeline = new PipelineRunner(buildPipelineConfig(config, projectRoot, {
        quiet: opts.json,
      }));

      const result = await runAgentSession({
        sessionId,
        bookId,
        sessionKind,
        actionSource,
        requestedIntent,
        language: config.language ?? "vi",
        pipeline,
        projectRoot,
        model: client._piModel
          ? client._piModel
          : { provider: config.llm.provider ?? "openai", modelId: config.llm.model },
        apiKey: client._apiKey,
      }, input);

      const responseText = result.responseText;
      const session = {
        sessionId,
        sessionKind,
        activeBookId: bookId ?? undefined,
      };

      if (opts.json) {
        process.stdout.write(`${JSON.stringify({
          responseText,
          session,
        }, null, 2)}\n`);
        return;
      }

      if (responseText) {
        process.stdout.write(`${responseText}\n`);
      }
    });
}
