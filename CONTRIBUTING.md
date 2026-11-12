# Contributing

Thanks for helping improve the Skrap.ai Node.js SDK.

## Setup

```bash
npm install
npm run check   # lint, typecheck, unit tests, build
npm run test:dist   # load the build as ESM and CommonJS
```

The unit tests mock HTTP and never call the API.

The live smoke test makes three calls and spends at most 1 credit. It runs only when you ask for it:

```bash
SKRAP_API_KEY=sk_... npm run test:smoke
```

## Pull requests

- Keep changes focused, and add or update tests for any behaviour you change.
- The package must stay free of runtime dependencies and keep working on Node.js 18.
- Add a line to `CHANGELOG.md` under an "Unreleased" heading.
- Never commit API keys, `.env` files or captured responses that contain personal data.

For API questions, see https://skrap.ai/docs/api. To report a security issue, follow [SECURITY.md](SECURITY.md) and do not open a public issue.
