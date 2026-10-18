import { strFromU8, unzipSync } from 'fflate';
import type { SourceVersion } from './versions';

// Textures added in Minecraft 1.8 that did not exist in 1.7.
export const TEXTURES_1_8_REGEX =
	/(?:sea_lantern|prismarine|red_sandstone|door_acacia|door_dark_oak|coarse_dirt|iron_trapdoor|diorite|granite|andesite|sponge_wet|banner|armor_stand|guardian|rabbit|endermite)/i;

export type DetectionResult =
	| {
			status: 'supported';
			version: SourceVersion;
			confident: boolean;
	  }
	| {
			status: 'modern';
			format?: number;
			detail: string;
	  };

export function formatToVersionName(format: number): string {
	if (format >= 97) return 'around 26.3';
	if (format >= 88) return 'around 26.2';
	if (format >= 84) return 'around 26.1';
	if (format >= 75) return 'around 1.21.11';
	if (format >= 46) return 'around 1.21.4';
	if (format >= 42) return 'around 1.21.2';
	if (format >= 34) return 'around 1.21';
	if (format >= 32) return 'around 1.20.6';
	if (format >= 22) return 'around 1.20.4';
	if (format >= 18) return 'around 1.20.2';
	if (format >= 15) return 'around 1.20';
	if (format >= 13) return 'around 1.19.4';
	if (format >= 9) return 'around 1.19';
	if (format >= 8) return 'around 1.18';
	if (format >= 7) return 'around 1.17';
	if (format >= 6) return 'around 1.16.5';
	if (format >= 5) return 'around 1.15 to 1.16.1';
	if (format >= 4) return 'around 1.13 to 1.14';
	if (format >= 3) return 'around 1.11 to 1.12';
	if (format >= 2) return 'around 1.9 to 1.10';
	return 'newer version';
}

export function detectVersion(data: Uint8Array, filename = ''): DetectionResult {
	let mcmetaBytes: Uint8Array | undefined;
	let hasModernSingularFolders = false;
	let has18Texture = false;

	try {
		const unzipped = unzipSync(data, {
			filter(entry) {
				const cleanName = entry.name.replace(/^(\.\/)+/, '').replaceAll('\\', '/');

				// 1. Ignore everything under converter_legacy/
				if (cleanName.startsWith('converter_legacy/') || cleanName.includes('/converter_legacy/')) {
					return false;
				}

				// Decompress pack.mcmeta only
				if (cleanName === 'pack.mcmeta' || cleanName.endsWith('/pack.mcmeta')) {
					return true;
				}

				// 2. Check for singular block/item folders (modern 1.13+)
				if (/(?:^|\/)textures\/(?:block|item)\//i.test(cleanName)) {
					hasModernSingularFolders = true;
				}

				// 3. Check for 1.8 textures
				if (TEXTURES_1_8_REGEX.test(cleanName)) {
					has18Texture = true;
				}

				return false;
			},
		});

		for (const [name, bytes] of Object.entries(unzipped)) {
			const clean = name.replace(/^(\.\/)+/, '').replaceAll('\\', '/');
			if (clean === 'pack.mcmeta' || clean.endsWith('/pack.mcmeta')) {
				mcmetaBytes = bytes;
				break;
			}
		}
	} catch {
		return { status: 'supported', version: '1.8', confident: false };
	}

	// Check pack.mcmeta first
	if (mcmetaBytes) {
		try {
			const parsed = JSON.parse(strFromU8(mcmetaBytes));
			if (parsed && typeof parsed === 'object') {
				const pack = parsed.pack;
				let formatNum: number | undefined;
				if (typeof pack?.pack_format === 'number') {
					formatNum = pack.pack_format;
				} else if (Array.isArray(pack?.pack_format) && typeof pack.pack_format[0] === 'number') {
					formatNum = pack.pack_format[0];
				} else if (Array.isArray(pack?.min_format) && typeof pack.min_format[0] === 'number') {
					formatNum = pack.min_format[0];
				} else if (Array.isArray(pack?.max_format) && typeof pack.max_format[0] === 'number') {
					formatNum = pack.max_format[0];
				}

				if (formatNum !== undefined && formatNum > 1) {
					const versionHint = formatToVersionName(formatNum);
					return {
						status: 'modern',
						format: formatNum,
						detail: `This pack is already for a newer version (pack format ${formatNum}, ${versionHint}). The updater only converts 1.7 and 1.8 packs.`,
					};
				}
			}
		} catch {
			// Continue to folder and texture checks if JSON is invalid
		}
	}

	// Treat singular texture folders as modern
	if (hasModernSingularFolders) {
		return {
			status: 'modern',
			detail:
				'This pack is already for a newer version (uses modern block and item texture folders). The updater only converts 1.7 and 1.8 packs.',
		};
	}

	// Pack format 1 with old folder names: check for 1.8 textures
	if (has18Texture) {
		return { status: 'supported', version: '1.8', confident: true };
	}

	// Check filename hints if textures were ambiguous
	if (/(?:^|[^\d])1\.7(?:[^\d]|$)/i.test(filename)) {
		return { status: 'supported', version: '1.7', confident: true };
	}
	if (/(?:^|[^\d])1\.8(?:[^\d]|$)/i.test(filename)) {
		return { status: 'supported', version: '1.8', confident: true };
	}

	// Ambiguous pack -> default to 1.8 unconfident ("Assumed: 1.8")
	return { status: 'supported', version: '1.8', confident: false };
}

export function detectVersionFromZip(data: Uint8Array): SourceVersion {
	const result = detectVersion(data);
	return result.status === 'supported' ? result.version : '1.8';
}
