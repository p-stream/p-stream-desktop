# P-Stream Desktop

Desktop app for P-Stream (movie-web) that provides enhanced streaming capabilities through browser extension integration.

## Features

- Native desktop wrapper for P-Stream
- Enhanced streaming capabilities via browser extension
- Automatic update checking from GitHub releases
- Discord Rich Presence integration
- Cross-platform support (macOS, Windows, Linux)
- Configurable settings menu (`ctrl/cmd + ,`)

## Installation

Download the latest [release](https://github.com/p-stream/p-stream-desktop/releases)

For **MacOS** it will fail to open, go to Settings > Privacy and Security, and press `Open Anyway`. Confirm with password or Touch ID!

## Development

```bash
pnpm install
```

```bash
pnpm start
```

## Building

Build the app for your current platform:

```bash
pnpm run build
```

Build for specific platforms:

```bash
pnpm run build:mac    # macOS
pnpm run build:win    # Windows
pnpm run build:linux  # Linux
```

The built files will be available in the `dist/` directory.

## Releasing

The project uses GitHub Actions for automated building and releasing. When you create a new release on GitHub, the workflow will automatically:

1. Build the app for all platforms (Linux, Windows, macOS)
2. Build for both x64 and ARM64 architectures where supported
3. Upload all binaries to the GitHub release

To create a release:

1. Go to the [Releases](https://github.com/p-stream/p-stream-desktop/releases) page
2. Click "Create a new release"
3. Create a new tag (e.g., `v1.1.0`)
4. Publish the release

The workflow will automatically build and attach all platform binaries to your release.

### Manual Release (Draft)

You can also trigger a draft release manually:

1. Go to [Actions](https://github.com/p-stream/p-stream-desktop/actions)
2. Select "Build and Release" workflow
3. Click "Run workflow"
4. Optionally specify a version tag
5. Check "Create draft release"
