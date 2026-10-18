# Resource Pack Updater

A web tool for updating Minecraft Java Edition 1.7 and 1.8 resource packs to newer versions. Select a ZIP, confirm the detected original version, pick the target version, and download the updated pack.

All conversions run locally in your browser using a dedicated Web Worker. Your files are never uploaded to any server.

## Run locally

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Run tests and production builds:

```sh
npm test
npm run build
npm run preview
```

## Deploy on Vercel

Import this repository into Vercel and use the Vite preset. `vercel.json` configures the build command (`npm run build`), the output directory (`dist`), and security headers.

On deploy, Vercel sets `VERCEL_GIT_COMMIT_SHA`. The build script injects this commit hash into the footer as a link to GitHub. Local builds show `dev` instead.

## Supported versions

| Source | Target | Resource pack format |
| --- | --- | --- |
| 1.7 or 1.8 | 26.3 | 97.1 |
| 1.7 or 1.8 | 26.2 | 88.0 |
| 1.7 or 1.8 | 26.1 | 84.0 |
| 1.7 or 1.8 | 1.21.11 | 75.0 |
| 1.7 or 1.8 | 1.20.6 | 32 |
| 1.7 or 1.8 | 1.19.4 | 13 |
| 1.7 or 1.8 | 1.16.5 | 6 |
| 1.7 or 1.8 | 1.12.2 | 3 |

Packs are checked against Minecraft 1.8 texture additions (`sea_lantern`, `prismarine`, `red_sandstone`, acacia and dark oak doors) to tell 1.7 from 1.8. If a pack is already modern (pack format greater than 1, or modern `textures/block` and `textures/item` folders), the tool displays a notice and disables conversion.

Files that cannot be converted safely move into `converter_legacy/` so that no assets are lost.

The browser accepts ZIPs up to 256 MB, up to 30,000 files, and up to 512 MB expanded.

## Sources and attribution

- Forward conversion mappings and logic derive from [agentdid127/ResourcePackConverter](https://github.com/agentdid127/ResourcePackConverter) and Hypixel Inc. See [LICENSE](LICENSE) and [Hypixel notice](public/HYPIXEL-LICENSE).
- Sign coordinates derive from [Mojang Slicer](https://github.com/Mojang/slicer). Its [MIT notice](public/MOJANG-SLICER-LICENSE.txt) is included.

Not affiliated with Mojang or Microsoft.
