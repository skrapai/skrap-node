# Security policy

## Reporting a vulnerability

If you think you've found a vulnerability in this SDK or in the Skrap.ai service, email **contact@skrap.ai**. Include the details and the steps to reproduce it. Please don't open a public issue for security reports.

While testing, please don't access other people's data and don't disrupt the service.

## Supported versions

Security fixes go into the latest released version.

## API keys

- Keep API keys on the server. Never ship them to a browser or a mobile app, and never commit them to source control.
- The SDK reads the key from the `apiKey` option or the `SKRAP_API_KEY` environment variable. It sends the key only in the `x-api-key` header and never logs or prints it.
- If a key leaks, revoke it in the app under **Settings → API keys & MCP** and create a new one. You can also give each key an IP allowlist and an expiry date.
