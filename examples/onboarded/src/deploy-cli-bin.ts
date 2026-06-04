#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node";
import { fixedClockFromIso } from "@schematics/git-artifacts/node";
import { Effect } from "effect";
import { runOnboardedDeployCliEffect } from "./deploy-cli";

const clock = fixedClockFromIso(process.env["E2E_NOW"]) ?? undefined;

NodeRuntime.runMain(
  runOnboardedDeployCliEffect(process.argv.slice(2), { clock }).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        if (result.stdout) process.stdout.write(`${result.stdout}\n`);
        if (result.stderr) process.stderr.write(`${result.stderr}\n`);
        process.exitCode = result.exitCode;
      }),
    ),
  ),
);
