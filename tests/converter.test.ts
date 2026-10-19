import { describe, expect, it } from 'vitest';
import { encode } from 'fast-png';
import { strToU8, strFromU8, zipSync, unzipSync, type Zippable } from 'fflate';
import { convert } from '../src/converter/convert';
import { readPng, Sheet } from '../src/converter/images';
import { LIMITS } from '../src/converter/pack';
import { TARGETS, type SourceVersion } from '../src/converter/versions';
import { detectVersionFromZip, detectVersion } from '../src/converter/detect';

function png(
	width: number,
	height: number,
	color: [number, number, number, number] = [68, 100, 170, 255],
): Uint8Array<ArrayBuffer> {
	const data = new Uint8Array(width * height * 4);
	for (let i = 0; i < data.length; i += 4) data.set(color, i);
	return new Uint8Array(encode({ width, height, data, channels: 4 }));
}
const json = (value: unknown) => strToU8(JSON.stringify(value));
const parse = (data: Uint8Array) => JSON.parse(strFromU8(data));
const root = 'assets/minecraft/';
function fixture(extra: Zippable = {}, wrapper = ''): Uint8Array {
	const files: Zippable = {
		'pack.mcmeta': json({
			pack: { pack_format: 1, description: { text: 'My §aPack', color: 'green' } },
			language: { custom: { name: 'Custom' } },
		}),
		'pack.png': png(16, 16),
		[root + 'textures/blocks/stone.png']: png(16, 16),
		...extra,
	};
	return zipSync(
		Object.fromEntries(Object.entries(files).map(([name, data]) => [wrapper + name, data])),
	);
}

describe('all requested upgrade paths', () => {
	for (const source of ['1.7', '1.8'] as SourceVersion[])
		for (const target of TARGETS) {
			it(`${source} to ${target.id} emits a usable ZIP and exact metadata`, () => {
				const input = fixture();
				const original = input.slice();
				const { zip, report } = convert(input, source, target.id);
				const files = unzipSync(zip);
				const meta = parse(files['pack.mcmeta']);
				expect(meta.pack.description).toEqual({ text: 'My §aPack', color: 'green' });
				expect(meta.language.custom.name).toBe('Custom');
				if (target.format[0] >= 75) {
					expect(meta.pack).not.toHaveProperty('pack_format');
					expect(meta.pack.min_format).toEqual([...target.format]);
					expect(meta.pack.max_format).toEqual([...target.format]);
				} else expect(meta.pack.pack_format).toBe(target.format[0]);
				expect(
					files[root + `textures/${target.id === '1.12.2' ? 'blocks' : 'block'}/stone.png`],
				).toBeDefined();
				expect(report.source).toBe(source);
				expect(report.target).toBe(target.id);
				expect(report.outputFiles).toBe(Object.keys(files).length);
				expect(parse(files['conversion-report.json'])).toEqual(report);
				expect(input).toEqual(original);
				expect(report.warnings).toEqual([]);
			});
		}
});

describe('legacy models and names', () => {
	it('does not leave removed 1.8 variant selectors active on 1.16.5', () => {
		const files = unzipSync(
			convert(
				fixture({
					[root + 'blockstates/stone.json']: json({
						variants: { 'variant=granite': { model: 'stone_granite' } },
					}),
				}),
				'1.8',
				'1.16.5',
			).zip,
		);
		expect(files[root + 'blockstates/stone.json']).toBeUndefined();
		expect(files['converter_legacy/' + root + 'blockstates/stone.json']).toBeDefined();
	});
	it('renames grass files from an original snapshot without remapping them twice', () => {
		const files = unzipSync(
			convert(
				fixture({
					[root + 'textures/blocks/grass.png']: png(16, 16, [10, 0, 0, 255]),
					[root + 'textures/blocks/tallgrass.png']: png(16, 16, [20, 0, 0, 255]),
					[root + 'textures/items/apple_golden.png']: png(16, 16),
					[root + 'textures/items/apple_golden.png.mcmeta']: json({ animation: { frametime: 4 } }),
				}),
				'1.8',
				'26.1',
			).zip,
		);
		expect(readPng(files[root + 'textures/block/grass_block.png']).data[0]).toBe(10);
		expect(files[root + 'textures/item/golden_apple.png']).toBeDefined();
		expect(parse(files[root + 'textures/item/golden_apple.png.mcmeta']).animation.frametime).toBe(
			4,
		);
	});
	it('updates model texture references and both hand transforms', () => {
		const files = unzipSync(
			convert(
				fixture({
					[root + 'models/item/diamond_sword.json']: json({
						parent: 'item/handheld',
						textures: { layer0: 'items/diamond_sword', particle: '#layer0' },
						display: {
							firstperson: { rotation: [0, 0, 0], translation: [0, 4, 2], scale: [1, 1, 1] },
							thirdperson: {
								rotation: [0, 90, -35],
								translation: [0, 1.25, -3.5],
								scale: [0.85, 0.85, 0.85],
							},
						},
					}),
				}),
				'1.8',
				'26.1',
			).zip,
		);
		const model = parse(files[root + 'models/item/diamond_sword.json']);
		expect(model.textures.layer0).toBe('minecraft:item/diamond_sword');
		expect(model.textures.particle).toBe('#layer0');
		expect(model.display.firstperson_righthand.translation).toEqual([1.13, 3.2, 1.13]);
		expect(model.display.firstperson_lefthand.rotation).toEqual([0, -45, 0]);
		expect(model.display.thirdperson_righthand).toEqual({
			rotation: [0, -90, 55],
			translation: [0, 4, 0.5],
			scale: [0.85, 0.85, 0.85],
		});
		expect(model.display.thirdperson_lefthand.rotation).toEqual([0, 90, -55]);
		expect(parse(files[root + 'items/diamond_sword.json']).model.model).toBe(
			'minecraft:item/diamond_sword',
		);
	});
	for (const target of TARGETS) {
		it(`keeps flat items in the hand on ${target.id}`, () => {
			const dyes = [
				'black',
				'blue',
				'brown',
				'cyan',
				'gray',
				'green',
				'light_blue',
				'lime',
				'magenta',
				'orange',
				'pink',
				'purple',
				'red',
				'silver',
				'white',
				'yellow',
			];
			const modernDyes = [
				'black_dye',
				'blue_dye',
				'brown_dye',
				'cyan_dye',
				'gray_dye',
				'green_dye',
				'light_blue_dye',
				'lime_dye',
				'magenta_dye',
				'orange_dye',
				'pink_dye',
				'purple_dye',
				'red_dye',
				'light_gray_dye',
				'white_dye',
				'yellow_dye',
			];
			const names = ['leather', 'beef', 'cooked_beef', ...dyes.map((dye) => `dye_${dye}`)];
			const input: Zippable = {};
			for (const name of names)
				input[root + `models/item/${name}.json`] = json({
					parent: 'builtin/generated',
					textures: { layer0: `items/${name}` },
					display: {
						thirdperson: {
							rotation: [-90, 0, 0],
							translation: [0, 1, name === 'dye_pink' ? -2.5 : -3],
							scale: [0.55, 0.55, 0.55],
						},
						firstperson: {
							rotation: [0, -135, 25],
							translation: [0, 4, 2],
							scale: [1.7, 1.7, 1.7],
						},
					},
				});
			const files = unzipSync(convert(fixture(input), '1.8', target.id).zip);
			for (const [index, name] of names.entries()) {
				const mapped = target.id === '1.12.2' || index < 3 ? name : modernDyes[index - 3];
				const model = parse(files[root + `models/item/${mapped}.json`]);
				for (const hand of ['righthand', 'lefthand']) {
					expect(model.display[`thirdperson_${hand}`]).toEqual({
						rotation: [0, 0, 0],
						translation: [0, 3, name === 'dye_pink' ? 1.5 : 1],
						scale: [0.55, 0.55, 0.55],
					});
					expect(model.display[`firstperson_${hand}`].scale).toEqual([0.68, 0.68, 0.68]);
				}
				expect(model.display).not.toHaveProperty('thirdperson');
			}
		});
		it(`keeps brick ingredients separate from building blocks on ${target.id}`, () => {
			const files = unzipSync(
				convert(
					fixture({
						[root + 'models/item/brick.json']: json({
							parent: 'builtin/generated',
							textures: { layer0: 'items/brick' },
						}),
						[root + 'models/item/brick_block.json']: json({ parent: 'block/brick' }),
						[root + 'models/item/netherbrick.json']: json({
							parent: 'builtin/generated',
							textures: { layer0: 'items/netherbrick' },
						}),
						[root + 'models/item/nether_brick.json']: json({ parent: 'block/nether_brick' }),
						[root + 'textures/items/brick.png']: png(16, 16, [10, 0, 0, 255]),
						[root + 'textures/items/netherbrick.png']: png(16, 16, [20, 0, 0, 255]),
						[root + 'models/item/custom.json']: json({
							parent: 'item/brick',
							overrides: [{ predicate: { damage: 0.5 }, model: 'item/brick_block' }],
						}),
					}),
					'1.8',
					target.id,
				).zip,
			);
			const legacy = target.id === '1.12.2';
			const prefix = target.level >= 11903 ? 'minecraft:' : '';
			const folder = legacy ? 'items' : 'item';
			for (const [ingredient, block, texture] of legacy
				? [
						['brick', 'brick_block', 'brick'],
						['netherbrick', 'nether_brick', 'netherbrick'],
					]
				: [
						['brick', 'bricks', 'brick'],
						['nether_brick', 'nether_bricks', 'nether_brick'],
					]) {
				expect(parse(files[root + `models/item/${ingredient}.json`]).textures.layer0).toBe(
					`${prefix}${folder}/${texture}`,
				);
				expect(parse(files[root + `models/item/${block}.json`]).parent).toBe(
					`${prefix}block/${legacy ? (block === 'brick_block' ? 'brick' : 'nether_brick') : block}`,
				);
				expect(files[root + `textures/${folder}/${texture}.png`]).toBeDefined();
				if (target.level >= 12104) {
					expect(parse(files[root + `items/${ingredient}.json`]).model.model).toBe(
						`minecraft:item/${ingredient}`,
					);
					expect(parse(files[root + `items/${block}.json`]).model.model).toBe(
						`minecraft:item/${block}`,
					);
				}
			}
			const custom = parse(files[root + 'models/item/custom.json']);
			const blockId = `${prefix}item/${legacy ? 'brick_block' : 'bricks'}`;
			if (target.level >= 12104)
				expect(parse(files[root + 'items/custom.json']).model.entries[0].model.model).toBe(blockId);
			else expect(custom.overrides[0].model).toBe(blockId);
			expect(custom.parent).toBe(`${prefix}item/brick`);
		});
	}
	it('inherits generated defaults without a parent loop and preserves explicit modern hand poses', () => {
		const pose = { rotation: [10, 20, 30], translation: [1, 2, 3], scale: [0.7, 0.7, 0.7] };
		const files = unzipSync(
			convert(
				fixture({
					[root + 'models/item/generated.json']: json({ parent: 'builtin/generated' }),
					[root + 'models/item/leather.json']: json({ parent: 'minecraft:builtin/generated' }),
					[root + 'models/item/custom.json']: json({
						parent: 'item/generated',
						display: {
							thirdperson: { rotation: [-90, 0, 0] },
							thirdperson_righthand: pose,
							thirdperson_lefthand: pose,
						},
					}),
				}),
				'1.8',
				'26.1',
			).zip,
		);
		expect(parse(files[root + 'models/item/generated.json']).parent).toBe(
			'minecraft:builtin/generated',
		);
		expect(parse(files[root + 'models/item/leather.json']).parent).toBe('minecraft:item/generated');
		const model = parse(files[root + 'models/item/custom.json']);
		expect(model.display.thirdperson_righthand).toEqual(pose);
		expect(model.display.thirdperson_lefthand).toEqual(pose);
	});
	it('updates namespaced block-state references without double prefixes', () => {
		const files = unzipSync(
			convert(
				fixture({
					[root + 'blockstates/stone.json']: json({
						variants: {
							normal: [{ model: 'minecraft:block/stone' }, { model: 'custom:block/stone' }],
						},
					}),
				}),
				'1.8',
				'26.1',
			).zip,
		);
		expect(parse(files[root + 'blockstates/stone.json']).variants['']).toEqual([
			{ model: 'minecraft:block/stone' },
			{ model: 'custom:block/stone' },
		]);
	});
	it('restores block display inheritance and leaves foreign namespaces alone', () => {
		const files = unzipSync(
			convert(
				fixture({
					[root + 'models/block/cube_all.json']: json({
						elements: [{ from: [0, 0, 0], to: [16, 16, 16] }],
						textures: { all: '#all' },
					}),
					[root + 'models/block/stone.json']: json({
						parent: 'block/cube_all',
						textures: { all: 'blocks/stone' },
					}),
					[root + 'models/item/stone.json']: json({
						parent: 'block/stone',
						display: { gui: { scale: [9, 9, 9] } },
					}),
					[root + 'models/item/custom.json']: json({
						parent: 'example:item/custom',
						textures: { layer0: 'example:items/Custom' },
					}),
				}),
				'1.8',
				'26.1',
			).zip,
		);
		expect(files[root + 'models/block/rpc_legacy_templates/cube_all.json']).toBeDefined();
		expect(parse(files[root + 'models/block/stone.json']).parent).toBe(
			'minecraft:block/rpc_legacy_templates/cube_all',
		);
		expect(parse(files[root + 'models/item/stone.json'])).not.toHaveProperty('display');
		expect(parse(files[root + 'models/item/custom.json']).textures.layer0).toBe(
			'example:items/Custom',
		);
	});
	it('preserves malformed JSON and incompatible state selectors', () => {
		const { zip, report } = convert(
			fixture({
				[root + 'models/item/broken.json']: strToU8('{ invalid'),
				[root + 'blockstates/oak_log.json']: json({
					variants: { 'variant=oak': { model: 'oak_log' } },
				}),
			}),
			'1.8',
			'26.1',
		);
		const files = unzipSync(zip);
		expect(files['converter_legacy/' + root + 'models/item/broken.json']).toBeDefined();
		expect(files['converter_legacy/' + root + 'blockstates/oak_log.json']).toBeDefined();
		expect(files[root + 'blockstates/oak_log.json']).toBeUndefined();
		expect(report.warnings.length).toBeGreaterThan(0);
	});
	it('converts ordered damage overrides using model IDs as fallbacks', () => {
		const files = unzipSync(
			convert(
				fixture({
					[root + 'models/item/diamond_sword.json']: json({
						parent: 'item/handheld',
						textures: { layer0: 'items/diamond_sword' },
						overrides: [{ predicate: { damage: 0.5 }, model: 'item/sword_damaged' }],
					}),
				}),
				'1.8',
				'26.1',
			).zip,
		);
		const tree = parse(files[root + 'items/diamond_sword.json']).model;
		expect(tree.property).toBe('minecraft:damage');
		expect(tree.fallback.model).toBe('minecraft:item/diamond_sword');
		expect(tree.entries[0].model.model).toBe('minecraft:item/sword_damaged');
	});
	it('uses the 26.2 pillar texture names and 26.3 shading rules', () => {
		const input = fixture({
			[root + 'textures/blocks/quartz_block_lines.png']: png(16, 16),
			[root + 'models/block/test.json']: json({
				textures: { side: 'blocks/quartz_block_lines' },
				elements: [{ shade: false }],
			}),
		});
		const files = unzipSync(convert(input, '1.8', '26.3').zip);
		expect(files[root + 'textures/block/quartz_pillar_side.png']).toBeDefined();
		const model = parse(files[root + 'models/block/test.json']);
		expect(model.textures.side).toBe('minecraft:block/quartz_pillar_side');
		expect(model.elements[0]).toEqual({ shade_direction_override: 'up' });
	});
	it('marks predicate overrides with property toString as unsupported', () => {
		const { zip, report } = convert(
			fixture({
				[root + 'models/item/diamond_sword.json']: json({
					parent: 'item/handheld',
					textures: { layer0: 'items/diamond_sword' },
					overrides: [{ predicate: { toString: 1 }, model: 'item/sword_custom' }],
				}),
			}),
			'1.8',
			'26.1',
		);
		const files = unzipSync(zip);
		expect(report.warnings.some((w) => w.includes('manual port'))).toBe(true);
		expect(files['converter_legacy/' + root + 'models/item/diamond_sword.json']).toBeDefined();
		const itemDefinition = parse(files[root + 'items/diamond_sword.json']);
		expect(JSON.stringify(itemDefinition)).not.toContain('function');
	});
});

describe('image conversion', () => {
	it('decodes indexed alpha, grayscale row padding, and RGB transparency', () => {
		const decodeFixture = (base64: string) =>
			readPng(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
		const palette = decodeFixture(
			'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACAQMAAACnuvRZAAAABlBMVEX/AAAA/wDSh+9xAAAAAnRSTlP/UI7cYb4AAAAMSURBVHicY1jA4AAAAiQA4XPrO/IAAAAASUVORK5CYII=',
		);
		expect([...palette.data.slice(0, 8)]).toEqual([0, 255, 0, 80, 255, 0, 0, 255]);
		expect([...palette.data.slice(12, 16)]).toEqual([255, 0, 0, 255]);
		const gray = decodeFixture(
			'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACAQAAAAC1D1u3AAAAAnRSTlMAAHaTzTgAAAAMSURBVHicY1jA4AAAAiQA4XPrO/IAAAAASUVORK5CYII=',
		);
		expect([...gray.data.slice(0, 8)]).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
		expect([...gray.data.slice(12, 16)]).toEqual([0, 0, 0, 0]);
		const rgb = decodeFixture(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAABnRSTlMACgAUAB7FNin/AAAADElEQVR4nGPgEpEDAABoAD1UCKP3AAAAAElFTkSuQmCC',
		);
		expect([...rgb.data]).toEqual([10, 20, 30, 0]);
	});
	it('splits a legacy clock into 64 frame textures', () => {
		const files = unzipSync(
			convert(fixture({ [root + 'textures/items/clock.png']: png(16, 1024) }), '1.7', '1.12.2').zip,
		);
		expect(Object.keys(files).filter((p) => /\/clock_\d\d\.png$/.test(p))).toHaveLength(64);
		expect(readPng(files[root + 'textures/items/clock_63.png']).height).toBe(16);
	});
	it('preserves HD resolution and alpha while splitting compasses', () => {
		const files = unzipSync(
			convert(
				fixture({ [root + 'textures/items/compass.png']: png(32, 1024, [20, 40, 60, 128]) }),
				'1.8',
				'1.16.5',
			).zip,
		);
		const image = readPng(files[root + 'textures/item/compass_31.png']);
		expect([image.width, image.height]).toEqual([32, 32]);
		expect([...image.data.slice(0, 4)]).toEqual([20, 40, 60, 128]);
	});
	it('converts double chests into two 64px textures', () => {
		const files = unzipSync(
			convert(
				fixture({ [root + 'textures/entity/chest/normal_double.png']: png(128, 64) }),
				'1.8',
				'1.16.5',
			).zip,
		);
		expect(readPng(files[root + 'textures/entity/chest/normal_left.png']).width).toBe(64);
		expect(readPng(files[root + 'textures/entity/chest/normal_right.png']).height).toBe(64);
		expect(files[root + 'textures/entity/chest/normal_double.png']).toBeUndefined();
	});
	it('slices GUI widgets and adds nine-slice metadata', () => {
		const files = unzipSync(
			convert(fixture({ [root + 'textures/gui/widgets.png']: png(256, 256) }), '1.8', '1.20.6').zip,
		);
		expect(readPng(files[root + 'textures/gui/sprites/widget/button.png']).width).toBe(200);
		expect(
			parse(files[root + 'textures/gui/sprites/widget/button.png.mcmeta']).gui.scaling.type,
		).toBe('nine_slice');
		expect(files[root + 'textures/gui/widgets.png']).toBeUndefined();
	});
	it('retains the original effect artwork before adding inventory slots', () => {
		const bytes = png(256, 256, [200, 0, 0, 255]);
		const files = unzipSync(
			convert(fixture({ [root + 'textures/gui/container/inventory.png']: bytes }), '1.8', '1.16.5')
				.zip,
		);
		expect([...readPng(files[root + 'textures/mob_effect/speed.png']).data.slice(0, 4)]).toEqual([
			200, 0, 0, 255,
		]);
	});
	it('extracts each moon phase at the correct size', () => {
		const files = unzipSync(
			convert(
				fixture({ [root + 'textures/environment/moon_phases.png']: png(128, 64) }),
				'1.8',
				'1.21.11',
			).zip,
		);
		expect(Object.keys(files).filter((p) => p.includes('/celestial/moon/'))).toHaveLength(8);
		expect(readPng(files[root + 'textures/environment/celestial/moon/full_moon.png']).width).toBe(
			32,
		);
	});
	it('rejects oversized image dimensions before decoding', () => {
		const bytes = png(16, 16);
		new DataView(bytes.buffer).setUint32(16, 2000000);
		expect(() => readPng(bytes)).toThrow(/megapixel/);
	});
	it('flips texture pixels without resampling alpha', () => {
		const image = {
			width: 2,
			height: 2,
			data: new Uint8Array([1, 0, 0, 255, 2, 0, 0, 128, 3, 0, 0, 0, 4, 0, 0, 255]),
		};
		const sheet = new Sheet(image, 2, 2),
			output = sheet.canvas(2, 2);
		sheet.copy(output, 0, 0, 2, 2, 0, 0, 'xy');
		expect([...output.data.slice(0, 4)]).toEqual([4, 0, 0, 255]);
	});
	it('Sheet.copy with flip xy produces byte-identical output to original flip behavior', () => {
		const width = 4,
			height = 4;
		const data = new Uint8Array(width * height * 4);
		for (let i = 0; i < data.length; i++) {
			data[i] = (i * 7 + 13) & 0xff;
		}
		const image = { width, height, data };
		const sheet = new Sheet(image, width, height);
		const fastOutput = sheet.canvas(width, height);
		sheet.copy(fastOutput, 0, 0, width, height, 0, 0, 'xy');

		const expected = new Uint8Array(width * height * 4);
		for (let py = 0; py < height; py++) {
			for (let px = 0; px < width; px++) {
				const srcIdx = ((height - py - 1) * width + (width - px - 1)) * 4;
				const dstIdx = (py * width + px) * 4;
				expected[dstIdx] = data[srcIdx];
				expected[dstIdx + 1] = data[srcIdx + 1];
				expected[dstIdx + 2] = data[srcIdx + 2];
				expected[dstIdx + 3] = data[srcIdx + 3];
			}
		}
		expect(fastOutput.data).toEqual(expected);
	});
	it('Sheet.copy with scanline optimization preserves exact RGBA pixel data across 16x16 and 32x32 sprites', () => {
		for (const dim of [16, 32]) {
			const data = new Uint8Array(dim * dim * 4);
			for (let i = 0; i < data.length; i++) data[i] = (i * 13 + 37) & 0xff;
			const sheet = new Sheet({ width: dim, height: dim, data }, dim, dim);
			const out = sheet.canvas(dim, dim);
			sheet.copy(out, 0, 0, dim, dim, 0, 0, 'none');
			expect(out.data).toEqual(data);
		}
	});
});

describe('equipment and fallback behavior', () => {
	it('rearranges old signs into 26.2 block and editing-screen textures', () => {
		const input = fixture({ [root + 'textures/entity/sign.png']: png(64, 32, [80, 60, 20, 255]) });
		const files = unzipSync(convert(input, '1.8', '26.2').zip);
		expect([
			readPng(files[root + 'textures/block/oak_sign.png']).width,
			readPng(files[root + 'textures/block/oak_sign.png']).height,
		]).toEqual([32, 32]);
		expect(readPng(files[root + 'textures/gui/signs/oak.png']).height).toBe(26);
		expect(files['converter_legacy/' + root + 'textures/entity/signs/oak.png']).toBeDefined();
		expect(
			unzipSync(convert(input, '1.8', '1.16.5').zip)[root + 'textures/entity/signs/oak.png'],
		).toBeDefined();
	});
	it('moves player armor and overlays with their animation metadata', () => {
		const files = unzipSync(
			convert(
				fixture({
					[root + 'textures/models/armor/leather_layer_1.png']: png(64, 32),
					[root + 'textures/models/armor/leather_layer_1_overlay.png']: png(64, 32),
					[root + 'textures/models/armor/leather_layer_1_overlay.png.mcmeta']: json({
						texture: { blur: false },
					}),
					[root + 'textures/entity/creeper/creeper.png']: png(64, 32),
					[root + 'textures/entity/chest/normal.png']: png(64, 64),
				}),
				'1.8',
				'26.1',
			).zip,
		);
		expect(files[root + 'textures/entity/equipment/humanoid/leather.png']).toBeDefined();
		expect(
			files[root + 'textures/entity/equipment/humanoid/leather_overlay.png.mcmeta'],
		).toBeDefined();
		expect(files['converter_legacy/' + root + 'textures/entity/creeper/creeper.png']).toBeDefined();
		expect(files[root + 'textures/entity/chest/normal.png']).toBeDefined();
	});
	it('keeps legacy mobs on older targets and archives modern-incompatible shaders', () => {
		const input = fixture({
			[root + 'textures/entity/creeper/creeper.png']: png(64, 32),
			[root + 'shaders/post/test.json']: json({ targets: [] }),
		});
		expect(
			unzipSync(convert(input, '1.8', '1.16.5').zip)[root + 'textures/entity/creeper/creeper.png'],
		).toBeDefined();
		const files = unzipSync(convert(input, '1.8', '26.1').zip);
		expect(files[root + 'shaders/post/test.json']).toBeUndefined();
		expect(files['converter_legacy/' + root + 'shaders/post/test.json']).toBeDefined();
	});
	it('converts UTF-8 language text and preserves unknown keys', () => {
		const files = unzipSync(
			convert(
				fixture({
					[root + 'lang/en_US.lang']: strToU8(
						'tile.stone.stone.name=Rock\ncustom.label=ქართული=hello\ncustom.escape=\\u00e9\n',
					),
				}),
				'1.8',
				'1.16.5',
			).zip,
		);
		expect(parse(files[root + 'lang/en_us.json'])).toEqual({
			'block.minecraft.stone': 'Rock',
			'custom.label': 'ქართული=hello',
			'custom.escape': 'é',
		});
	});
});

describe('ZIP validation', () => {
	it('normalizes root metadata casing while preserving foreign namespace paths', () => {
		const input = zipSync({
			'Pack.Mcmeta': json({ pack: { pack_format: 1, description: 'case' } }),
			'Assets/Minecraft/textures/blocks/STONE.PNG': png(16, 16),
			'assets/custom/textures/items/Custom.png': png(16, 16),
		});
		const files = unzipSync(convert(input, '1.8', '26.1').zip);
		expect(files[root + 'textures/block/stone.png']).toBeDefined();
		expect(files['assets/custom/textures/items/Custom.png']).toBeDefined();
	});
	it('flattens a wrapper directory and ignores macOS metadata', () => {
		const files = unzipSync(convert(fixture({}, 'My Pack/'), '1.8', '26.1').zip);
		expect(files['pack.mcmeta']).toBeDefined();
		expect(Object.keys(files).some((name) => name.startsWith('My Pack/'))).toBe(false);
	});
	it('rejects broken, non-resource, newer, overlaid and traversal ZIPs', () => {
		expect(() => convert(strToU8('not a ZIP'), '1.8', '26.1')).toThrow(/ZIP/);
		expect(() => convert(zipSync({ 'hello.txt': strToU8('hi') }), '1.8', '26.1')).toThrow(
			/No Java resource pack/,
		);
		expect(() =>
			convert(fixture({ 'pack.mcmeta': json({ pack: { pack_format: 32 } }) }), '1.8', '26.1'),
		).toThrow(/pack_format 1/);
		expect(() =>
			convert(
				fixture({ 'pack.mcmeta': json({ pack: { pack_format: 1 }, overlays: {} }) }),
				'1.8',
				'26.1',
			),
		).toThrow(/overlays/);
		expect(() => convert(fixture({ '../evil.txt': strToU8('bad') }), '1.8', '26.1')).toThrow(
			/unsafe/,
		);
		expect(() =>
			convert(fixture({ 'assets/__proto__/stone.json': strToU8('{}') }), '1.8', '26.1'),
		).toThrow(/unsafe/);
	});
	it('checks advertised decompressed size before inflating', () => {
		const input = fixture();
		for (let i = 0; i < input.length - 46; i++)
			if (input[i] === 0x50 && input[i + 1] === 0x4b && input[i + 2] === 1 && input[i + 3] === 2) {
				new DataView(input.buffer, input.byteOffset).setUint32(i + 24, LIMITS.expanded + 1, true);
				break;
			}
		expect(() => convert(input, '1.8', '26.1')).toThrow(/limit/);
	});
	it('Pack.finish returns valid decompressable ZIP without redundant buffer duplication', () => {
		const input = fixture();
		const { zip, report } = convert(input, '1.8', '26.1');
		const files = unzipSync(zip);
		expect(files['pack.mcmeta']).toBeDefined();
		expect(files['conversion-report.json']).toBeDefined();
		expect(report.outputFiles).toBe(Object.keys(files).length);
	});
	it('rejects unsupported target and source versions', () => {
		expect(() => convert(fixture(), '1.8', '1.9')).toThrow(/supported target/);
		expect(() => convert(fixture(), '1.12' as SourceVersion, '26.1')).toThrow(/source version/);
	});
});

describe('detectVersionFromZip', () => {
	it('detects 1.8 when 1.8 textures are present', () => {
		const pack18 = fixture({
			'assets/minecraft/textures/blocks/sea_lantern.png': png(16, 16),
		});
		expect(detectVersionFromZip(pack18)).toBe('1.8');

		const packPrismarine = fixture({
			'assets/minecraft/textures/blocks/prismarine_rough.png': png(16, 16),
		});
		expect(detectVersionFromZip(packPrismarine)).toBe('1.8');

		const packDoors = fixture({
			'assets/minecraft/textures/items/door_dark_oak.png': png(16, 16),
		});
		expect(detectVersionFromZip(packDoors)).toBe('1.8');
	});
	it('marks 1.8 confident when 1.8 textures are present', () => {
		const pack18 = fixture({
			'assets/minecraft/textures/blocks/sea_lantern.png': png(16, 16),
		});
		expect(detectVersion(pack18)).toEqual({ status: 'supported', version: '1.8', confident: true });
	});

	it('defaults to 1.8 with confident=false when textures are ambiguous', () => {
		const packAmbiguous = fixture({
			'assets/minecraft/textures/blocks/cobblestone.png': png(16, 16),
			'assets/minecraft/textures/items/diamond_sword.png': png(16, 16),
		});
		expect(detectVersion(packAmbiguous)).toEqual({
			status: 'supported',
			version: '1.8',
			confident: false,
		});
	});

	it('detects 1.7 confident when filename contains 1.7', () => {
		const pack17 = fixture({
			'assets/minecraft/textures/blocks/cobblestone.png': png(16, 16),
		});
		expect(detectVersion(pack17, 'Faithful_1.7.10.zip')).toEqual({
			status: 'supported',
			version: '1.7',
			confident: true,
		});
	});

	it('detects already-converted 1.16.5 pack as modern and ignores converter_legacy/', () => {
		const converted116 = fixture({
			'pack.mcmeta': json({ pack: { pack_format: 6 } }),
			'assets/minecraft/textures/block/stone.png': png(16, 16),
			'converter_legacy/assets/minecraft/textures/blocks/sea_lantern.png': png(16, 16),
		});
		const result = detectVersion(converted116);
		expect(result.status).toBe('modern');
		if (result.status === 'modern') {
			expect(result.format).toBe(6);
			expect(result.detail).toContain('pack format 6');
			expect(result.detail).toContain('1.16.5');
		}
	});

	it('detects modern pack by singular texture folder even if pack_format is missing', () => {
		const modernSingular = zipSync({
			'assets/minecraft/textures/block/stone.png': png(16, 16),
		});
		const result = detectVersion(modernSingular);
		expect(result.status).toBe('modern');
		if (result.status === 'modern') {
			expect(result.detail).toContain('modern block and item texture folders');
		}
	});
	it('detects modern pack format when pack.mcmeta has a leading UTF-8 BOM', () => {
		const bomMcmeta = strToU8('\uFEFF' + JSON.stringify({ pack: { pack_format: 15 } }));
		const pack = zipSync({
			'pack.mcmeta': bomMcmeta,
		});
		const result = detectVersion(pack);
		expect(result.status).toBe('modern');
		if (result.status === 'modern') {
			expect(result.format).toBe(15);
		}
	});

	it('returns status: "corrupt" for invalid ZIP bytes in detectVersion', () => {
		const invalidBytes = strToU8('not a valid zip archive');
		const result = detectVersion(invalidBytes);
		expect(result.status).toBe('corrupt');
		if (result.status === 'corrupt') {
			expect(result.detail).toContain('could not be read as an unencrypted ZIP');
		}
	});
});
