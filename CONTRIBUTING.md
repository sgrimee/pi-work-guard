# Contributing to pi-work-guard

Thanks for contributing.

## Development

Requirements:

- Node.js 22.19 or later
- A current Pi Coding Agent installation for extension smoke testing
- Git, when testing workspace detection

```bash
npm install
npm test
npm run build
npm pack --dry-run
```

## Pull requests

- Keep changes focused and include tests for behavior changes.
- Run the commands above before opening a pull request.
- Do not add credentials, real corporate domains, account emails, or proprietary repository URLs to fixtures, documentation, or commits.
- Changes to identity detection, workspace classification, and configuration handling must document their user-visible behavior and limitations.

## Reporting bugs

Use the issue tracker for reproducible defects and feature requests. For a suspected security issue, follow [SECURITY.md](SECURITY.md) instead.
