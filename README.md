# Resource Pack Updater

Update old Minecraft Java Edition 1.7 and 1.8 resource packs to newer versions, right in your browser.

**Use it here: https://resource-pack-updater.vercel.app/**

Everything runs locally in a Web Worker. Your pack is never uploaded to a server, and your original ZIP is left untouched.

## How to use

1. Open the [site](https://resource-pack-updater.vercel.app/) and drop in one or more resource pack ZIPs, or select them together in the file picker.
2. The original version (1.7 or 1.8) is detected for each pack. You can override it per pack.
3. Pick the version you want to update all selected packs to.
4. Click **Update pack** or **Update packs** and download each result. When multiple packs are ready, **Download all packs** downloads each converted pack as a separate file.

Packs convert one at a time. A failed pack does not stop the rest. Cancelling keeps completed downloads and lets you resume the remaining packs. Each input ZIP can be up to 256 MB.

## Supported versions

Converts 1.7 and 1.8 packs to any of these versions:

| Target  | Resource pack format |
| ------- | -------------------- |
| 26.3    | 97.1                 |
| 26.2    | 88.0                 |
| 26.1    | 84.0                 |
| 1.21.11 | 75.0                 |
| 1.20.6  | 32                   |
| 1.19.4  | 13                   |
| 1.16.5  | 6                    |
| 1.12.2  | 3                    |

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

## Issues

Found a pack that converts wrong or a bug in the tool? [Open an issue](https://github.com/qzvx/resource-pack-updater/issues) and attach the pack if you can.

## Star History

<a href="https://star-history.com/#qzvx/resource-pack-updater&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=qzvx/resource-pack-updater&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=qzvx/resource-pack-updater&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=qzvx/resource-pack-updater&type=Date" />
 </picture>
</a>

## Sources and attribution

- Forward conversion mappings and logic derive from [agentdid127/ResourcePackConverter](https://github.com/agentdid127/ResourcePackConverter) and Hypixel Inc. See [LICENSE](LICENSE) and [Hypixel notice](public/HYPIXEL-LICENSE).
- Sign coordinates derive from [Mojang Slicer](https://github.com/Mojang/slicer). Its [MIT notice](public/MOJANG-SLICER-LICENSE.txt) is included.

Not affiliated with Mojang or Microsoft.
