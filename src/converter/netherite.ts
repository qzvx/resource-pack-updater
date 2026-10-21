import { readPng, savePng, type Raster } from './images';
import { resource } from './names';
import type { Pack } from './pack';
import { isObject, type JsonObject } from './types';
import type { Target } from './versions';

const TOOLS = ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'];
const ARMOR = ['helmet', 'chestplate', 'leggings', 'boots'];
const PALETTE = [
	[18, 16, 22],
	[46, 39, 54],
	[75, 65, 80],
	[126, 113, 126],
];

export function retintNetherite(image: Raster, preserveHandles: boolean): Raster {
	const output = { ...image, data: image.data.slice() };
	for (let offset = 0; offset < output.data.length; offset += 4) {
		if (!image.data[offset + 3]) continue;
		const red = image.data[offset];
		const green = image.data[offset + 1];
		const blue = image.data[offset + 2];
		if (preserveHandles && red > green * 1.08 && green > blue * 1.1 && red > blue * 1.2) continue;
		const shade = ((red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255) * 3;
		const lower = Math.min(2, Math.floor(shade));
		for (let channel = 0; channel < 3; channel++)
			output.data[offset + channel] = Math.round(
				PALETTE[lower][channel] +
					(PALETTE[lower + 1][channel] - PALETTE[lower][channel]) * (shade - lower),
			);
	}
	return output;
}

const assetPath = (id: string, folder: string, extension: string): string => {
	const [namespace, name] = id.includes(':') ? id.split(':', 2) : ['minecraft', id];
	return `assets/${namespace}/${folder}/${name}${extension}`;
};

function copyTexture(pack: Pack, from: string, to: string, preserveHandles: boolean): boolean {
	const bytes = pack.files.get(from);
	if (!bytes || pack.files.has(to)) return false;
	try {
		savePng(pack, to, retintNetherite(readPng(bytes), preserveHandles));
		const metadata = pack.files.get(from + '.mcmeta');
		if (metadata && !pack.files.has(to + '.mcmeta')) pack.set(to + '.mcmeta', metadata);
		return true;
	} catch {
		pack.warn(`Could not create a netherite texture from ${from}. The original is unchanged.`);
		return false;
	}
}

function unusedId(pack: Pack, id: string, folder: string, extension: string): string {
	let candidate = id;
	let suffix = 2;
	while (pack.files.has(assetPath(candidate, folder, extension))) candidate = `${id}_${suffix++}`;
	return candidate;
}

function createItem(pack: Pack, target: Target, name: string, preserveHandles: boolean): void {
	const diamond = `item/diamond_${name}`;
	const netherite = `item/netherite_${name}`;
	const texturePath = assetPath(netherite, 'textures', '.png');
	const modelPath = assetPath(netherite, 'models', '.json');
	if (
		pack.files.has(texturePath) ||
		pack.files.has(modelPath) ||
		pack.files.has(assetPath(netherite.slice(5), 'items', '.json'))
	)
		return;
	const textures = new Map<string, string>();
	const models = new Map<string, string>();
	const canonical = (value: string, kind: 'texture' | 'model'): string => {
		const mapped = resource(value, kind, target);
		return mapped.includes(':') ? mapped : `minecraft:${mapped}`;
	};
	const defaultTexture = copyTexture(
		pack,
		assetPath(diamond, 'textures', '.png'),
		texturePath,
		preserveHandles,
	);
	if (defaultTexture) textures.set(`minecraft:${diamond}`, `minecraft:${netherite}`);
	function cloneTexture(value: string): string {
		if (value.startsWith('#')) return value;
		const id = canonical(value, 'texture');
		const cached = textures.get(id);
		if (cached) return cached;
		const [namespace, path] = id.split(':', 2);
		const destination = unusedId(
			pack,
			`${namespace}:item/converter_netherite/netherite_${name}/${path}`,
			'textures',
			'.png',
		);
		if (
			copyTexture(
				pack,
				assetPath(id, 'textures', '.png'),
				assetPath(destination, 'textures', '.png'),
				preserveHandles,
			)
		) {
			textures.set(id, destination);
			return destination;
		}
		return id;
	}
	function cloneModel(value: string, destination?: string): string {
		const id = canonical(value, 'model');
		const cached = models.get(id);
		if (cached) return cached;
		const original = pack.json(assetPath(id, 'models', '.json'));
		if (!original) return id;
		const [namespace, path] = id.split(':', 2);
		const output =
			destination ??
			unusedId(
				pack,
				`${namespace}:item/converter_netherite/netherite_${name}/${path}`,
				'models',
				'.json',
			);
		models.set(id, output);
		const model: JsonObject = structuredClone(original);
		if (typeof model.parent === 'string') model.parent = cloneModel(model.parent);
		if (isObject(model.textures))
			for (const [key, texture] of Object.entries(model.textures)) {
				if (typeof texture !== 'string') continue;
				const expanded = key === 'layer0' && !/[/:#]/.test(texture) ? `items/${texture}` : texture;
				model.textures[key] = cloneTexture(expanded);
			}
		if (Array.isArray(model.overrides))
			for (const override of model.overrides)
				if (isObject(override) && typeof override.model === 'string')
					override.model = cloneModel(override.model);
		pack.write(assetPath(output, 'models', '.json'), model);
		return output;
	}
	if (pack.files.has(assetPath(diamond, 'models', '.json')))
		cloneModel(diamond, `minecraft:${netherite}`);
	else if (defaultTexture)
		pack.write(modelPath, {
			parent: preserveHandles ? 'minecraft:item/handheld' : 'minecraft:item/generated',
			textures: { layer0: `minecraft:${netherite}` },
		});
}

export function createNetherite(pack: Pack, target: Target): void {
	if (target.level < 11600) return;
	for (const name of TOOLS) createItem(pack, target, name, true);
	for (const name of ARMOR) createItem(pack, target, name, false);
	for (const layer of [1, 2]) {
		const destination = `assets/minecraft/textures/models/armor/netherite_layer_${layer}.png`;
		const equipment = `assets/minecraft/textures/entity/equipment/${layer === 1 ? 'humanoid' : 'humanoid_leggings'}/netherite.png`;
		if (pack.files.has(destination) || pack.files.has(equipment)) continue;
		copyTexture(
			pack,
			`assets/minecraft/textures/models/armor/diamond_layer_${layer}.png`,
			destination,
			false,
		);
	}
}
