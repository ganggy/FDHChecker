# Documentation entry point

Choose documents by task. Current code, configuration, and tests establish
implemented behavior; documentation describes intent and operating procedures.
Resolve discrepancies explicitly rather than treating an old completion report
as the current project state.

| Task | Start here |
| --- | --- |
| Product scope and architecture overview | [Project README](../README.md) |
| Local development | [Quick start](../QUICK_START.md), [package scripts](../package.json) |
| Remaining work | [Backlog](../BACKLOG.md) |
| Production deployment | [Deployment guide](../deploy/README.md) |
| Local AI and Ollama | [Local AI setup](../LOCAL_AI_SETUP_TH.md) |
| User workflows | [Manual by role](USER_MANUAL_BY_ROLE.md) |
| Mobile connectivity | [Mobile connection](MOBILE_CONNECTION.md) |
| Agent development conventions | [AGENTS.md](../AGENTS.md) |

## Historical reports

Root documents named `FINAL_*`, `COMPLETE_*`, `*_SUMMARY*`, and dated fix or
delivery reports are historical context unless their contents establish current
applicability. Read them when investigating that specific change. Their names
do not certify current test results or production readiness. Keep existing files
and links intact; update the relevant primary guide when behavior changes.

## AI changes identified in the September 2026 audit

Before evaluating a different OpenAI model, address the hardcoded reasoning
effort in `server/aiService.ts` and make its JSON option enforce an output schema
for query planning and Vault editing. Preserve the SQL validation boundary.
Compare models on the same synthetic questions, measuring answer correctness,
clarification frequency, latency, and usage. These are pending implementation
items, not completed changes or a requirement to replace Ollama.
