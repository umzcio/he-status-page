# Contributing

Thanks for your interest in improving HE Status Page. Contributions of all sizes are welcome.

## Development setup

See the [Quick start (development)](README.md#quick-start-development) section of the README for prerequisites (Node >= 20, PostgreSQL 16), installation, and how to run the services locally.

## Branches & pull requests

- Create a feature branch off the default branch; don't commit directly to it.
- Keep pull requests focused — one logical change per PR.
- Describe what changed and why, and link any related issue.
- Make sure the app builds and the test suite passes before opening a PR.

## Tests

Run the suite before submitting:

```bash
npm test
```

Add or update tests when you change behavior, especially for poller adapters and shared utilities.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) are preferred (e.g. `feat:`, `fix:`, `docs:`, `chore:`). This keeps history readable and makes changes easy to scan.

## Code of conduct

Be respectful and constructive. Assume good faith, and help keep this a welcoming project for contributors from every institution.
