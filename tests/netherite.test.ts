import { describe, expect, it, vi } from 'vitest';
import { encode } from 'fast-png';
import { strToU8, strFromU8, zipSync, unzipSync, type Zippable } from 'fflate';
import { convert } from '../src/converter/convert';
import { readPng, type Raster } from '../src/converter/images';
import { retintNetherite } from '../src/converter/netherite';
import { TARGETS, type SourceVersion } from '../src/converter/versions';
import type { WorkerRequest, WorkerResponse } from '../src/converter/types';

const root = 'assets/minecraft/';
const names = [
	'sword',
	'pickaxe',
	'axe',
	'shovel',
	'hoe',
	'helmet',
	'chestplate',
	'leggings',
	'boots',
];
const json = (value: unknown) => strToU8(JSON.stringify(value));
const parse = (bytes: Uint8Array) => JSON.parse(strFromU8(bytes));
const animation = json({ animation: { frametime: 3, interpolate: true, frames: [1, 0] } });

function png(width = 32, height = 64): Uint8Array {
	const data = new Uint8Array(width * height * 4);
	for (let offset = 0; offset < data.length; offset += 4)
		data.set([40, 150, 180, offset % 12 === 0 ? 0 : 160], offset);
	return encode({ width, height, data, channels: 4 });
}

function fixture(extra: Zippable = {}): Uint8Array {
	return zipSync({
		'pack.mcmeta': json({ pack: { pack_format: 1, description: 'Netherite test' } }),
		[root + 'textures/blocks/stone.png']: png(16, 16),
		...extra,
	});
}

describe('netherite pixels', () => {
	it('keeps shapes, transparency, shading, and brown handles without modifying diamond', () => {
		const pixels = [
			[10, 60, 70, 255],
			[40, 150, 180, 128],
			[100, 240, 255, 255],
			[120, 80, 40, 255],
			[40, 150, 180, 0],
		];
		const image: Raster = { width: 5, height: 1, data: new Uint8Array(pixels.flat()) };
		const output = retintNetherite(image, true);
		expect(image.data).toEqual(new Uint8Array(pixels.flat()));
		expect(output.width).toBe(5);
		expect(output.height).toBe(1);
		for (const index of [0, 1, 2]) {
			const [red, green, blue, alpha] = output.data.slice(index * 4, index * 4 + 4);
			expect(alpha).toBe(pixels[index][3]);
			expect(blue).toBeGreaterThan(red);
			expect(red).toBeGreaterThan(green);
			expect(red).toBeLessThan(pixels[index][1]);
		}
		expect(output.data[0]).toBeLessThan(output.data[4]);
		expect(output.data[4]).toBeLessThan(output.data[8]);
		expect([...output.data.slice(12)]).toEqual(pixels.slice(3).flat());
		expect(retintNetherite(image, false).data.slice(12, 15)).not.toEqual(image.data.slice(12, 15));
	});
});

describe('netherite conversion', () => {
	for (const source of ['1.7', '1.8'] as SourceVersion[])
		for (const target of TARGETS)
			it(`generates matching items and worn armor from ${source} to ${target.id}`, () => {
				const texture = png();
				const armor = png(128, 64);
				const extra: Zippable = {};
				for (const name of names) {
					extra[root + `textures/items/diamond_${name}.png`] = texture;
					extra[root + `textures/items/diamond_${name}.png.mcmeta`] = animation;
				}
				for (const layer of [1, 2]) {
					extra[root + `textures/models/armor/diamond_layer_${layer}.png`] = armor;
					extra[root + `textures/models/armor/diamond_layer_${layer}.png.mcmeta`] = animation;
				}
				const { zip, report } = convert(fixture(extra), source, target.id);
				const files = unzipSync(zip);
				expect(report.warnings).toEqual([]);
				if (target.level < 11600) {
					expect(Object.keys(files).some((path) => path.includes('netherite'))).toBe(false);
					return;
				}
				for (const name of names) {
					const path = root + `textures/item/netherite_${name}.png`;
					expect(files[root + `textures/item/diamond_${name}.png`]).toEqual(texture);
					expect(files[path]).toBeDefined();
					expect(files[path + '.mcmeta']).toEqual(animation);
					const image = readPng(files[path]);
					expect([image.width, image.height]).toEqual([32, 64]);
					expect(image.data.filter((_, index) => index % 4 === 3)).toEqual(
						readPng(texture).data.filter((_, index) => index % 4 === 3),
					);
					const model = parse(files[root + `models/item/netherite_${name}.json`]);
					expect(model.textures.layer0).toBe(`minecraft:item/netherite_${name}`);
					expect(model.parent).toBe(
						`minecraft:item/${names.indexOf(name) < 5 ? 'handheld' : 'generated'}`,
					);
					if (target.level >= 12104)
						expect(parse(files[root + `items/netherite_${name}.json`])).toEqual({
							model: { type: 'minecraft:model', model: `minecraft:item/netherite_${name}` },
						});
					else expect(files[root + `items/netherite_${name}.json`]).toBeUndefined();
				}
				for (const layer of [1, 2]) {
					const folder = layer === 1 ? 'humanoid' : 'humanoid_leggings';
					const base = target.level >= 12102 ? `entity/equipment/${folder}/` : 'models/armor/';
					const suffix = target.level >= 12102 ? '.png' : `_layer_${layer}.png`;
					const path = root + `textures/${base}netherite${suffix}`;
					expect(files[root + `textures/${base}diamond${suffix}`]).toEqual(armor);
					expect(files[path + '.mcmeta']).toEqual(animation);
					expect(readPng(files[path])).toEqual(retintNetherite(readPng(armor), false));
				}
			});

	it('copies custom geometry, parents, texture aliases, override models, and hand transforms', () => {
		const custom = 'assets/custom/';
		const elements = [{ from: [0, 0, 0], to: [16, 2, 16], faces: { up: { texture: '#blade' } } }];
		const files = unzipSync(
			convert(
				fixture({
					[root + 'models/item/diamond_sword.json']: json({
						parent: 'custom:item/base',
						textures: { blade: 'custom:weapons/blade', particle: '#blade' },
						display: { firstperson: { scale: [2, 2, 2] } },
						overrides: [{ predicate: { damage: 0.5 }, model: 'custom:item/damaged' }],
					}),
					[custom + 'models/item/base.json']: json({ elements }),
					[custom + 'models/item/damaged.json']: json({
						parent: 'custom:item/base',
						textures: { blade: 'custom:weapons/blade' },
					}),
					[custom + 'textures/weapons/blade.png']: png(),
					[custom + 'textures/weapons/blade.png.mcmeta']: animation,
				}),
				'1.8',
				'26.1',
			).zip,
		);
		const diamond = parse(files[root + 'models/item/diamond_sword.json']);
		const netherite = parse(files[root + 'models/item/netherite_sword.json']);
		expect(diamond.parent).toBe('custom:item/base');
		expect(diamond.textures.blade).toBe('custom:weapons/blade');
		expect(netherite.display).toEqual(diamond.display);
		expect(netherite.textures.particle).toBe('#blade');
		const modelPath = (id: string) => `assets/${id.replace(':', '/models/')}.json`;
		const texturePath = (id: string) => `assets/${id.replace(':', '/textures/')}.png`;
		expect(parse(files[modelPath(netherite.parent)]).elements).toEqual(elements);
		expect(netherite.parent).not.toBe(diamond.parent);
		expect(readPng(files[texturePath(netherite.textures.blade)])).toEqual(
			retintNetherite(readPng(png()), true),
		);
		expect(files[texturePath(netherite.textures.blade) + '.mcmeta']).toEqual(animation);
		const tree = parse(files[root + 'items/netherite_sword.json']).model;
		expect(tree.type).toBe('minecraft:range_dispatch');
		const override = parse(files[modelPath(tree.entries[0].model.model)]);
		expect(override.parent).toBe(netherite.parent);
		expect(override.textures.blade).toBe(netherite.textures.blade);
	});

	it('retints inherited textures and bare legacy layer0 references', () => {
		const files = unzipSync(
			convert(
				fixture({
					[root + 'textures/items/diamond_axe.png']: png(),
					[root + 'models/item/diamond_axe.json']: json({ parent: 'item/custom_axe' }),
					[root + 'models/item/custom_axe.json']: json({
						parent: 'builtin/generated',
						textures: { layer0: 'diamond_axe' },
					}),
				}),
				'1.8',
				'1.16.5',
			).zip,
		);
		const model = parse(files[root + 'models/item/netherite_axe.json']);
		const parent = parse(files[`assets/${model.parent.replace(':', '/models/')}.json`]);
		expect(parent.textures.layer0).toBe('minecraft:item/netherite_axe');
	});

	it('leaves existing netherite artwork and models intact', () => {
		const existing = png(16, 16);
		const files = unzipSync(
			convert(
				fixture({
					[root + 'textures/items/diamond_sword.png']: png(),
					[root + 'textures/items/netherite_sword.png']: existing,
					[root + 'textures/items/netherite_sword.png.mcmeta']: animation,
					[root + 'textures/items/diamond_axe.png']: png(),
					[root + 'models/item/netherite_axe.json']: json({
						parent: 'item/handheld',
						textures: { layer0: 'items/diamond_axe' },
					}),
					[root + 'textures/models/armor/diamond_layer_1.png']: png(128, 64),
					[root + 'textures/models/armor/netherite_layer_1.png']: existing,
					[root + 'textures/models/armor/diamond_layer_2.png']: png(128, 64),
					[root + 'textures/entity/equipment/humanoid_leggings/netherite.png']: existing,
				}),
				'1.8',
				'26.1',
			).zip,
		);
		expect(files[root + 'textures/item/netherite_sword.png']).toEqual(existing);
		expect(files[root + 'textures/item/netherite_sword.png.mcmeta']).toEqual(animation);
		expect(files[root + 'textures/item/netherite_axe.png']).toBeUndefined();
		expect(parse(files[root + 'models/item/netherite_axe.json']).textures.layer0).toBe(
			'minecraft:item/diamond_axe',
		);
		for (const folder of ['humanoid', 'humanoid_leggings'])
			expect(files[root + `textures/entity/equipment/${folder}/netherite.png`]).toEqual(existing);
	});

	it('does not invent missing artwork', () => {
		const missing = unzipSync(convert(fixture(), '1.8', '26.1').zip);
		expect(Object.keys(missing).some((path) => path.includes('netherite'))).toBe(false);
	});

	it('reports corrupt PNGs without failing the pack or changing diamond textures', () => {
		const corrupt = strToU8('not a PNG');
		const { zip, report } = convert(
			fixture({ [root + 'textures/items/diamond_sword.png']: corrupt }),
			'1.8',
			'26.1',
		);
		const files = unzipSync(zip);
		expect(files[root + 'textures/item/diamond_sword.png']).toEqual(corrupt);
		expect(files[root + 'textures/item/netherite_sword.png']).toBeUndefined();
		expect(files[root + 'models/item/netherite_sword.json']).toBeUndefined();
		expect(report.warnings).toEqual([
			expect.stringContaining('Could not create a netherite texture'),
		]);
	});
});

it('automatically generates netherite through the real worker conversion pipeline', async () => {
	const messages: WorkerResponse[] = [];
	const worker = {
		onmessage: undefined as ((event: MessageEvent<WorkerRequest>) => Promise<void>) | undefined,
		postMessage: (message: WorkerResponse) => messages.push(message),
	};
	vi.stubGlobal('self', worker);
	try {
		await import('../src/converter/worker');
		const file = new File(
			[new Uint8Array(fixture({ [root + 'textures/items/diamond_sword.png']: png() }))],
			'netherite-worker.zip',
		);
		for (const target of ['26.3', '1.12.2'] as const) {
			messages.length = 0;
			await worker.onmessage!({
				data: {
					type: 'convert',
					file,
					source: '1.8',
					target,
				},
			} as MessageEvent<WorkerRequest>);
			const result = messages.at(-1)!;
			expect(result.type).toBe('done');
			if (result.type !== 'done') throw new Error('Worker conversion did not finish.');
			const files = unzipSync(result.zip);
			expect(Boolean(files[root + 'textures/item/netherite_sword.png'])).toBe(target !== '1.12.2');
			expect(result.report.warnings).toEqual([]);
		}
	} finally {
		vi.unstubAllGlobals();
	}
});
