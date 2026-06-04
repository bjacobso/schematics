#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { runOnboardedDeployCliEffect } from "./deploy-cli";

NodeRuntime.runMain(
  runOnboardedDeployCliEffect(process.argv.slice(2)).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        if (result.stdout) process.stdout.write(`${result.stdout}\n`);
        if (result.stderr) process.stderr.write(`${result.stderr}\n`);
        process.exitCode = result.exitCode;
      }),
    ),
  ),
);
