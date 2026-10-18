import { Pack } from './pack';
import { renameFiles } from './names';
import { convertMetadata } from './metadata';
import { convertBlockstates, convertModels, preserveTemplates } from './models';
import { convertTextures, finishTextures, finishInventory } from './textures';
import { sliceAtlases } from './slices';
import { modernAssets, convertAtlases } from './modern';
import { convertSigns } from './signs';
import { getTarget, type SourceVersion } from './versions';
import type { Progress } from './types';

export function convert(
	data: Uint8Array,
	source: SourceVersion,
	targetId: string,
	progress: (value: Progress) => void = () => {},
): ReturnType<Pack['finish']> {
	if (source !== '1.7' && source !== '1.8')
		throw new Error('Choose Minecraft 1.7 or 1.8 as the source version.');
	const target = getTarget(targetId);
	progress({ percent: 3, stage: 'Opening your pack' });
	const pack = new Pack(data, source, target.id);
	const steps: [string, () => void][] = [
		['Preserving custom model templates', () => preserveTemplates(pack, target)],
		['Updating asset names', () => renameFiles(pack, target)],
		['Updating pack metadata and languages', () => convertMetadata(pack, target)],
		[
			'Converting models and block states',
			() => {
				convertModels(pack, target);
				convertBlockstates(pack, target);
			},
		],
		['Converting texture layouts', () => convertTextures(pack, target)],
		['Updating inventory and interface textures', () => finishTextures(pack, target)],
		[
			'Splitting texture sheets',
			() => {
				sliceAtlases(pack, target, source);
				finishInventory(pack);
			},
		],
		[
			'Updating equipment and renderer assets',
			() => {
				convertSigns(pack, target);
				modernAssets(pack, target);
			},
		],
		['Registering texture atlases', () => convertAtlases(pack, target)],
	];
	steps.forEach(([stage, run], index) => {
		progress({ percent: 10 + index * 9, stage });
		run();
	});
	progress({ percent: 94, stage: 'Building your converted ZIP' });
	const result = pack.finish();
	progress({ percent: 100, stage: 'Ready to download' });
	return result;
}
