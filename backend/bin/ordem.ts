#!/usr/bin/env bun
import { runCli } from '../src/cli/main'

await runCli(process.argv.slice(2))
