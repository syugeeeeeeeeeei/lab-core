import { spawn } from "node:child_process";
import type { SpawnOptionsWithoutStdio } from "node:child_process";
import { env } from "../lib/env.js";

export type CommandResult = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  dryRun: boolean;
};

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

export async function runCommand(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio = {}
): Promise<CommandResult> {
  const formatted = formatCommand(command, args);

  if (env.executionMode === "dry-run") {
    return {
      command: formatted,
      stdout: "[dry-run] command execution skipped",
      stderr: "",
      exitCode: 0,
      dryRun: true
    };
  }

  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      env: {
        ...process.env,
        ...options.env
      }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (exitCode) => {
      const result = {
        command: formatted,
        stdout,
        stderr,
        exitCode: exitCode ?? 1,
        dryRun: false
      };

      if ((exitCode ?? 1) !== 0) {
        const detail = stderr.trim().length > 0 ? stderr.trim() : "コマンドが失敗しました。";
        reject(new Error(`${formatted}\n${detail}`));
        return;
      }

      resolve(result);
    });
  });
}
