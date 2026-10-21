import guiData from './data/gui.json';
import particleData from './data/particles.json';
import paintingData from './data/paintings_kristoffer_zetterstrand.json';
import effectData from './data/mob_effect.json';
import mapData from './data/map_icons.json';
import moonData from './data/moon_phases.json';
import { savePng, withSheet } from './images';
import type { Pack } from './pack';
import { atLeast, type SourceVersion, type Target } from './versions';

type Predicate = { protocol?: { min_inclusive: number | null; max_inclusive: number | null } };
type Slice = {
	path: string;
	width: number;
	height: number;
	name?: string;
	delete?: boolean;
	predicate?: Predicate;
	textures: {
		path: string;
		box: { x: number; y: number; width: number; height: number };
		predicate?: Predicate;
		remove?: boolean;
		metadata?: string | object;
	}[];
};
const buttonMeta = {
	gui: {
		scaling: {
			type: 'nine_slice',
			width: 200,
			height: 20,
			border: { left: 20, top: 4, right: 20, bottom: 4 },
		},
	},
};

function allowed(predicate: Predicate | undefined, source: SourceVersion): boolean {
	const protocol = source === '1.8' ? 47 : 5;
	return (
		!predicate?.protocol ||
		(protocol >= (predicate.protocol.min_inclusive ?? 4) &&
			protocol <= (predicate.protocol.max_inclusive ?? Infinity))
	);
}

function slice(
	pack: Pack,
	root: string,
	definition: Slice,
	source: SourceVersion,
	metadata = false,
): void {
	if (!allowed(definition.predicate, source)) return;
	const path = root + definition.path;
	withSheet(pack, path, definition.width, definition.height, (sheet) => {
		const working = { ...sheet.image, data: sheet.image.data.slice() };
		for (const texture of definition.textures) {
			if (!allowed(texture.predicate, source)) continue;
			const b = texture.box;
			// Skip sprites added after the source edition. Empty pixels should not
			// override the target game's vanilla art.
			const crop = sheet.crop(b.x, b.y, b.width, b.height);
			const crosshair = texture.path === 'sprites/hud/crosshair.png';
			if (crosshair)
				for (let offset = 0; offset < crop.data.length; offset += 4)
					if (crop.data[offset] === 0 && crop.data[offset + 1] === 0 && crop.data[offset + 2] === 0)
						crop.data[offset + 3] = 0;
			if (!crosshair && !crop.data.some((alpha, i) => i % 4 === 3 && alpha > 0)) continue;
			savePng(pack, root + texture.path, crop);
			if (metadata && texture.metadata)
				pack.write(
					root + texture.path + '.mcmeta',
					texture.metadata === 'button_widget' ? buttonMeta : texture.metadata,
				);
			if (texture.remove) {
				for (let y = b.y * sheet.scaleY; y < (b.y + b.height) * sheet.scaleY; y++) {
					working.data.fill(
						0,
						(y * working.width + b.x * sheet.scaleX) * 4,
						(y * working.width + (b.x + b.width) * sheet.scaleX) * 4,
					);
				}
			}
		}
		pack.files.delete(path);
		pack.files.delete(path + '.mcmeta');
		if (definition.delete === false)
			savePng(pack, root + (definition.name ?? definition.path), working);
	});
}

export function sliceAtlases(pack: Pack, target: Target, source: SourceVersion): void {
	const root = 'assets/minecraft/textures/';
	if (atLeast(target, '1.13')) {
		withSheet(pack, root + 'particle/particles.png', 128, 128, (sheet) => {
			const output = sheet.canvas(256, 256);
			sheet.copy(output, 0, 0, 128, 128);
			savePng(pack, root + 'particle/particles.png', output);
		});
	}
	if (atLeast(target, '1.14')) {
		slice(pack, root + 'particle/', { ...particleData, width: 256, height: 256 } as Slice, source);
		pack.move(root + 'particle/fishing_hook.png', root + 'entity/fishing_hook.png');
		slice(pack, root + 'painting/', paintingData as Slice, source);
		slice(pack, root, effectData as Slice, source);
	}
	if (atLeast(target, '1.20.2'))
		for (const definition of guiData) slice(pack, root + 'gui/', definition as Slice, source, true);
	if (atLeast(target, '1.20.5')) slice(pack, root + 'map/', mapData as Slice, source);
	if (atLeast(target, '1.21.11')) {
		for (const name of ['sun', 'end_flash'])
			for (const ext of ['.png', '.png.mcmeta'])
				pack.move(root + `environment/${name}${ext}`, root + `environment/celestial/${name}${ext}`);
		slice(pack, root + 'environment/', moonData as Slice, source);
	}
}
