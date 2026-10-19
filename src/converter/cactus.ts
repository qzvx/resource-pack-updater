import { readPng } from './images';
import type { Pack } from './pack';
import { isObject, type Json, type JsonObject } from './types';
import { atLeast, type Target } from './versions';

const bounds = [
	[
		[0, 0, 0],
		[16, 16, 16],
	],
	[
		[0, 0, 1],
		[16, 16, 15],
	],
	[
		[1, 0, 0],
		[15, 16, 16],
	],
];
const directions = [
	['down', 'up'],
	['north', 'south'],
	['west', 'east'],
];
const same = (value: Json, expected: number[]) =>
	Array.isArray(value) &&
	value.length === expected.length &&
	value.every((n, i) => n === expected[i]);

function standardElements(): JsonObject[] {
	return bounds.map(([from, to], i) => ({
		from: [...from],
		to: [...to],
		faces: Object.fromEntries(
			directions[i].map((direction) => [
				direction,
				{
					uv: [0, 0, 16, 16],
					texture: direction === 'down' ? '#bottom' : direction === 'up' ? '#top' : '#side',
					...(i === 0 ? { cullface: direction } : {}),
				},
			]),
		),
	}));
}

function isStandard(model: JsonObject): boolean {
	if (!Array.isArray(model.elements) || model.elements.length !== 3) return false;
	return model.elements.every((element, i) => {
		if (!isObject(element) || element.rotation || !isObject(element.faces)) return false;
		if (!same(element.from, bounds[i][0]) || !same(element.to, bounds[i][1])) return false;
		if (Object.keys(element.faces).length !== 2) return false;
		return directions[i].every((direction) => {
			const face = (element.faces as JsonObject)[direction];
			return (
				isObject(face) &&
				same(face.uv, [0, 0, 16, 16]) &&
				face.texture === (i === 0 ? (direction === 'down' ? '#bottom' : '#top') : '#side')
			);
		});
	});
}

export function convertCactus(pack: Pack, target: Target): void {
	const folder = atLeast(target, '1.13') ? 'block' : 'blocks';
	const bytes = pack.files.get(`assets/minecraft/textures/${folder}/cactus_side.png`);
	if (!bytes) return;
	let image;
	try {
		image = readPng(bytes);
	} catch {
		return;
	}
	// A one-pixel border in a 4x or 8x texture is wider than vanilla's one-unit inset.
	if (![4, 8].includes(image.width) || image.height % image.width !== 0) return;
	let hasBorder = false;
	for (let y = 0; y < image.height; y++) {
		const alpha = (x: number) => image.data[(y * image.width + x) * 4 + 3];
		for (let x = 1; x < image.width - 1; x++) if (alpha(x) !== 255) return;
		if (alpha(0) === 0 && alpha(image.width - 1) === 0) hasBorder = true;
	}
	if (!hasBorder) return;
	const path = 'assets/minecraft/models/block/cactus.json';
	const existing = pack.json(path);
	// Only adapt vanilla geometry. A pack's custom shape or UV layout is intentional.
	if (existing && !isStandard(existing)) return;
	if (
		existing &&
		(!isObject(existing.textures) ||
			![
				'block/cactus_side',
				'minecraft:block/cactus_side',
				'blocks/cactus_side',
				'minecraft:blocks/cactus_side',
			].includes(String(existing.textures.side)))
	)
		return;
	const model: JsonObject = existing ?? {
		parent: 'minecraft:block/block',
		textures: {
			particle: `${folder}/cactus_side`,
			bottom: `${folder}/cactus_bottom`,
			top: `${folder}/cactus_top`,
			side: `${folder}/cactus_side`,
		},
		elements: standardElements(),
	};
	const elements = model.elements as JsonObject[];
	const inset = 16 / image.width;
	// The opaque body starts one texture pixel in. Meet it at all four corners;
	// keep the full-width faces so the transparent border still carries the spikes.
	(elements[1].from as number[])[2] = inset;
	(elements[1].to as number[])[2] = 16 - inset;
	(elements[2].from as number[])[0] = inset;
	(elements[2].to as number[])[0] = 16 - inset;
	pack.write(path, model);
}
