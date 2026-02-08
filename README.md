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

<div align="center">
<table>
<tr>
<td align="center" width="150">
<a href="https://github.com/p-stream/p-stream-desktop/releases/download/1.2.2/P-Stream.Setup.1.2.2.exe">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/devicons/devicon/master/icons/windows11/windows11-original.svg">
  <img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/windows11/windows11-original.svg" width="80" height="80" alt="Windows"/>
</picture>
<br/><b>Windows</b>
</a>
</td>
<td align="center" width="150">
<a href="https://github.com/p-stream/p-stream-desktop/releases/download/1.2.2/P-Stream-1.2.2-arm64.dmg">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/devicons/devicon/master/icons/apple/apple-original.svg">
  <img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/apple/apple-original.svg" width="80" height="80" alt="macOS"/>
</picture>
<br/><b>macOS</b>
</a>
</td>
<td align="center" width="150">
<a href="https://github.com/p-stream/p-stream-desktop/releases/download/1.2.2/P-Stream-1.2.2.AppImage">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/devicons/devicon/master/icons/linux/linux-original.svg">
  <img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/linux/linux-original.svg" width="80" height="80" alt="Linux"/>
</picture>
<br/><b>Linux</b>
</a>
</td>
</tr>
</table>

<sub>
macOS Intel: <a href="https://github.com/p-stream/p-stream-desktop/releases/download/1.2.2/P-Stream-1.2.2.dmg">Download</a> ·
Linux ARM: <a href="https://github.com/p-stream/p-stream-desktop/releases/download/1.2.2/P-Stream-1.2.2-arm64.AppImage">Download</a>
</sub>
</div>

**macOS:** If it won't open, go to Settings > Privacy & Security and click "Open Anyway".

## Development

```bash
pnpm install
pnpm start
```

## Building

Build for your current platform:

```bash
pnpm run build
```

Build for specific platforms:

```bash
pnpm run build:mac    # macOS
pnpm run build:win    # Windows
pnpm run build:linux  # Linux
```

Built files will be in the `dist/` directory.

## Releasing

The project uses GitHub Actions for automated building. When you create a release, the workflow automatically:

1. Builds for all platforms (Linux, Windows, macOS)
2. Builds for both x64 and ARM64 architectures
3. Uploads all binaries to the release

To create a release:

1. Go to [Releases](https://github.com/p-stream/p-stream-desktop/releases)
2. Click "Create a new release"
3. Create a new tag (e.g., `v1.1.0`)
4. Publish the release

### Manual Draft Release

1. Go to [Actions](https://github.com/p-stream/p-stream-desktop/actions)
2. Select "Build and Release" workflow
3. Click "Run workflow"
4. Optionally specify a version tag
5. Check "Create draft release"
