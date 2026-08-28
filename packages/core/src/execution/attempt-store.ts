import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SafeGovernanceIdSchema } from "../governance/contracts.js";
import {
  ExecutionAttemptSchema,
  type ExecutionAttempt,
} from "./attempt.js";

function attemptRelPath(attemptId: string): string {
  return join("story", "governance", "execution-attempts", `${SafeGovernanceIdSchema.parse(attemptId)}.json`);
}

export async function saveExecutionAttempt(
  bookDir: string,
  attempt: ExecutionAttempt,
): Promise<void> {
  const filePath = join(bookDir, attemptRelPath(attempt.attemptId));
  await mkdir(join(bookDir, "story", "governance", "execution-attempts"), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(attempt, null, 2)}\n`, "utf-8");
}

export async function loadExecutionAttempt(
  bookDir: string,
  attemptId: string,
): Promise<ExecutionAttempt | null> {
  try {
    const filePath = join(bookDir, attemptRelPath(attemptId));
    const raw = await readFile(filePath, "utf-8");
    return ExecutionAttemptSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listExecutionAttempts(
  bookDir: string,
  chapterNumber?: number,
): Promise<ReadonlyArray<ExecutionAttempt>> {
  const dirPath = join(bookDir, "story", "governance", "execution-attempts");
  let files: string[] = [];
  try {
    files = await readdir(dirPath);
  } catch {
    return [];
  }

  const results: ExecutionAttempt[] = [];
  for (const f of files.filter((file) => file.endsWith(".json"))) {
    try {
      const raw = await readFile(join(dirPath, f), "utf-8");
      const attempt = ExecutionAttemptSchema.parse(JSON.parse(raw));
      if (chapterNumber === undefined || attempt.chapterNumber === chapterNumber) {
        results.push(attempt);
      }
    } catch {
      // Ignore corrupt attempt
    }
  }

  return results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
