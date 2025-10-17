# Repository Guidelines

## Project Structure & Module Organization
- `src/whatsapp/`: session bootstrap, message listeners, and queue handlers for inbound chats.
- `src/summarizer/`: prompt builders, LLM adapters, and summarization pipelines.
- `src/shared/`: cross-cutting helpers (logging, metrics, error mappers) kept framework-agnostic.
- `src/config/`: runtime configuration loaders plus schema validation; keep defaults in `config/.env.example`.
- `tests/`: mirrors `src/` with Jest suites; fixtures and transcripts live under `tests/fixtures/`.
- `assets/`: design docs, flow diagrams, and sample WhatsApp exports for onboarding.

## Build, Test, and Development Commands
- `npm install`: installs Node 20 LTS dependencies defined in `package.json`.
- `npm run dev`: starts the local bot with hot reload and verbose logging.
- `npm run build`: compiles TypeScript sources into `dist/` for production deploys.
- `npm start`: executes the built bot from `dist/index.js`; use after `npm run build`.
- `npm run lint`: runs ESLint + Prettier in check mode; fails on formatting drift.
- `npm test`: executes Jest suites once; add `--watch` while iterating locally.

## Coding Style & Naming Conventions
Use TypeScript strict mode, 2-space indentation, and single quotes. Name files with kebab-case (`session-store.ts`). Classes stay PascalCase, functions camelCase, and constants SCREAMING_SNAKE_CASE. Prefer dependency inversion via interfaces in `src/shared/contracts/`. Run `npm run lint -- --fix` before pushing to auto-format.

## Testing Guidelines
Author Jest tests alongside features (`feature-name.spec.ts`) and keep data builders in `tests/factories/`. Target a minimum of 85% statement coverage; inspect `coverage/lcov-report/index.html` after `npm test -- --coverage`. Mock network I/O but cover error branches, especially around WhatsApp session recovery and summarizer fallbacks.

## Commit & Pull Request Guidelines
Follow Conventional Commit prefixes (`feat:`, `fix:`, `chore:`) and keep subject lines <= 72 chars. Describe the WHY in the body when behavior changes. For pull requests, provide a feature summary, link the tracked issue, attach screenshots or console logs for bot flows, and list manual test steps (e.g., `npm run dev` in a sandbox chat).

## Security & Configuration Tips
Copy `config/.env.example` to `.env.local` for secrets; never commit real tokens. Rotate WhatsApp session keys frequently and scrub transcript attachments before sharing. Audit dependency updates with `npm audit` and review OpenAI usage logs weekly for anomalies.
