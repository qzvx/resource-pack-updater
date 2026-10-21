import { describe, expect, it } from 'vitest';
import { encode } from 'fast-png';
import { strToU8, zipSync, unzipSync } from 'fflate';
import { convert } from '../src/converter/convert';
import { readPng } from '../src/converter/images';
import { TARGETS, type SourceVersion } from '../src/converter/versions';

const root = 'assets/minecraft/textures/gui/';

function icons(scale: number, backgroundAlpha = 255, visible = true): Uint8Array {
	const width = 256 * scale;
	const data = new Uint8Array(width * width * 4);
	for (let row = 0; row < 15 * scale; row++)
		for (let column = 0; column < 15 * scale; column++) {
			const offset = (row * width + column) * 4;
			data[offset + 3] = backgroundAlpha;
			if (visible && (Math.floor(row / scale) === 7 || Math.floor(column / scale) === 7))
				data.set([255, 255, 255, 255], offset);
		}
	data.set([0, 0, 0, 255], 16 * scale * 4);
	if (visible) data.set([128, 128, 128, 96], (2 * scale * width + 2 * scale) * 4);
	return encode({ width, height: width, data, channels: 4 });
}

function fixture(texture: Uint8Array): Uint8Array {
	return zipSync({
		'pack.mcmeta': strToU8(
			JSON.stringify({ pack: { pack_format: 1, description: 'Crosshair test' } }),
		),
		[root + 'icons.png']: texture,
	});
}

describe('legacy crosshair backgrounds', () => {
	for (const source of ['1.7', '1.8'] as SourceVersion[])
		for (const target of TARGETS.filter((entry) => entry.level >= 12002))
			for (const scale of [1, 2])
				it(`clears only the crosshair background from ${source} to ${target.id} at ${scale}x`, () => {
					const input = icons(scale);
					const original = readPng(input);
					const { zip, report } = convert(fixture(input), source, target.id);
					const files = unzipSync(zip);
					const crosshair = readPng(files[root + 'sprites/hud/crosshair.png']);
					expect([crosshair.width, crosshair.height]).toEqual([15 * scale, 15 * scale]);
					for (let row = 0; row < crosshair.height; row++)
						for (let column = 0; column < crosshair.width; column++) {
							const offset = (row * crosshair.width + column) * 4;
							const sourceOffset = (row * original.width + column) * 4;
							const pixel = original.data.slice(sourceOffset, sourceOffset + 4);
							if (pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0) pixel[3] = 0;
							expect(crosshair.data.slice(offset, offset + 4)).toEqual(pixel);
						}
					const heart = readPng(files[root + 'sprites/hud/heart/container.png']);
					expect([...heart.data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
					expect(report.warnings).toEqual([]);
				});

	for (const backgroundAlpha of [0, 255])
		it(`preserves an intentionally hidden crosshair with alpha ${backgroundAlpha}`, () => {
			const files = unzipSync(
				convert(fixture(icons(1, backgroundAlpha, false)), '1.8', '26.3').zip,
			);
			expect(files[root + 'sprites/hud/crosshair.png']).toBeDefined();
			const image = readPng(files[root + 'sprites/hud/crosshair.png']);
			expect(image.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(false);
		});

	it('keeps crosshair pixels unchanged for targets that still use the icons sheet', () => {
		const texture = icons(1);
		for (const target of TARGETS.filter((entry) => entry.level < 12002)) {
			const files = unzipSync(convert(fixture(texture), '1.8', target.id).zip);
			expect(files[root + 'icons.png']).toEqual(texture);
			expect(files[root + 'sprites/hud/crosshair.png']).toBeUndefined();
		}
	});
});
