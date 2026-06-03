#!/usr/bin/env node
import { runOnboardedDeployCli } from "./deploy-cli";

const result = await runOnboardedDeployCli(process.argv.slice(2));
if (result.stdout) process.stdout.write(`${result.stdout}\n`);
if (result.stderr) process.stderr.write(`${result.stderr}\n`);
process.exit(result.exitCode);
