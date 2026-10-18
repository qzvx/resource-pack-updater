import chestData from './data/chests.json';
import mapBase from './data/map-base.json';
import { blank, readPng, savePng, Sheet, withSheet } from './images';
import type { Pack } from './pack';
import { atLeast, type Target } from './versions';

export function convertTextures(pack: Pack, target: Target): void {
	const root = 'assets/minecraft/textures/';
	const item = atLeast(target, '1.13') ? 'item' : 'items';
	withSheet(pack, root + `${item}/clock.png`, 16, 1024, (sheet) => {
		for (let i = 0; i < 64; i++)
			savePng(
				pack,
				root + `${item}/clock_${String(i).padStart(2, '0')}.png`,
				sheet.crop(0, i * 16, 16, 16),
			);
		pack.files.delete(root + `${item}/clock.png`);
		pack.files.delete(root + `${item}/clock.png.mcmeta`);
	});
	withSheet(pack, root + `${item}/compass.png`, 16, 512, (sheet) => {
		for (let i = 0; i < 32; i++)
			savePng(
				pack,
				root + `${item}/compass_${String(i).padStart(2, '0')}.png`,
				sheet.crop(0, i * 16, 16, 16),
			);
		pack.files.delete(root + `${item}/compass.png`);
		pack.files.delete(root + `${item}/compass.png.mcmeta`);
	});
	withSheet(pack, root + 'gui/widgets.png', 256, 256, (sheet) => {
		const output = { ...sheet.image, data: sheet.image.data.slice() };
		for (const dx of [24, 60]) {
			for (let y = 22 * sheet.scaleY; y < 46 * sheet.scaleY; y++)
				output.data.fill(
					0,
					(y * output.width + dx * sheet.scaleX) * 4,
					(y * output.width + (dx + 29) * sheet.scaleX) * 4,
				);
			sheet.copy(output, 0, 0, 11, 22, dx, 23);
			sheet.copy(output, 171, 0, 11, 22, dx + 11, 23);
		}
		// The old sheet uses x=60 for the right offhand slot. The modern GUI
		// slicer expects x=53, so move that slot when creating sprite textures.
		if (atLeast(target, '1.20.2')) {
			const modified = new Sheet(output, 256, 256);
			modified.copy(output, 60, 22, 29, 24, 53, 22);
		}
		savePng(pack, root + 'gui/widgets.png', output);
		if (atLeast(target, '1.19.4')) {
			const slider = sheet.canvas(256, 256);
			for (let i = 0; i < 4; i++)
				sheet.copy(slider, 0, 46 + Math.max(0, i - 1) * 20, 200, 20, 0, i * 20);
			savePng(pack, root + 'gui/slider.png', slider);
		}
	});
	if (atLeast(target, '1.13')) {
		for (const name of ['water_flow', 'water_still', 'water_overlay']) {
			const path = root + `block/${name}.png`;
			if (!pack.files.has(path)) continue;
			try {
				const image = readPng(pack.files.get(path)!);
				for (let i = 0; i < image.data.length; i += 4) {
					const gray = Math.floor(
						image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114,
					);
					image.data[i] = image.data[i + 1] = image.data[i + 2] = gray;
				}
				savePng(pack, path, image);
			} catch {
				pack.archive(path);
				pack.warn(`Unsupported water texture preserved: ${path}`);
			}
		}
		withSheet(pack, root + 'map/map_icons.png', 32, 32, (sheet) => {
			const base = readPng(Uint8Array.from(atob(mapBase), (c) => c.charCodeAt(0)));
			const output = blank(128 * sheet.scaleX, 128 * sheet.scaleY);
			for (let y = 0; y < output.height; y++)
				for (let x = 0; x < output.width; x++) {
					const offset =
						(Math.floor(y / sheet.scaleY) * base.width + Math.floor(x / sheet.scaleX)) * 4;
					output.data.set(base.data.subarray(offset, offset + 4), (y * output.width + x) * 4);
				}
			for (let i = 0; i < 10; i++)
				sheet.copy(output, (i % 4) * 8, Math.floor(i / 4) * 8, 8, 8, i * 8, 0);
			savePng(pack, root + 'map/map_icons.png', output);
		});
	}
	if (atLeast(target, '1.15')) {
		const chestRoot = root + 'entity/chest/';
		type Op = [number, number, number, number, number, number, ('y' | 'xy')?];
		function chest(name: string, double: boolean): void {
			const path = chestRoot + name + (double ? '_double' : '') + '.png';
			withSheet(pack, path, double ? 128 : 64, 64, (sheet) => {
				for (const part of double ? (['left', 'right'] as const) : (['single'] as const)) {
					const output = sheet.canvas(64, 64);
					for (const [x, y, x2, y2, dx, dy, flip] of chestData[part] as Op[])
						sheet.copy(output, x, y, x2 - x, y2 - y, dx, dy, flip);
					savePng(pack, chestRoot + name + (double ? `_${part}` : '') + '.png', output);
				}
				if (double) pack.files.delete(path);
			});
		}
		for (const name of ['normal', 'trapped', 'christmas']) chest(name, true);
		for (const name of ['normal', 'trapped', 'christmas', 'ender']) chest(name, false);
		const glint = root + 'misc/enchanted_item_glint.png';
		if (pack.files.has(glint)) {
			try {
				const image = readPng(pack.files.get(glint)!);
				for (let i = 0; i < image.data.length; i += 4) {
					const gray = image.data[i];
					image.data[i] = Math.floor((gray * 128) / 255);
					image.data[i + 1] = Math.floor((gray * 64) / 255);
					image.data[i + 2] = Math.floor((gray * 204) / 255);
				}
				savePng(pack, glint, image);
			} catch {
				pack.archive(glint);
				pack.warn('The enchantment glint PNG could not be converted.');
			}
		}
	}
	// Run after effect icons have been sliced out of the inventory sheet.
}

export function finishTextures(pack: Pack, target: Target): void {
	const root = 'assets/minecraft/textures/';
	if (atLeast(target, '1.19.3')) {
		withSheet(pack, root + 'gui/container/creative_inventory/tabs.png', 256, 256, (sheet) => {
			const output = sheet.canvas(256, 256);
			for (const [index, original] of [0, 1, 2, 3, 4, 4, 5, 6].entries()) {
				sheet.copy(output, original * 28, 0, 14, 160, index * 26, 0);
				sheet.copy(output, original * 28 + 14, 0, 14, 160, index * 26 + 12, 0);
			}
			sheet.copy(output, 232, 0, 24, 15, 232, 0);
			savePng(pack, root + 'gui/container/creative_inventory/tabs.png', output);
		});
	}
	if (atLeast(target, '1.19.4'))
		for (const ext of ['.png', '.png.mcmeta']) {
			const old = root + 'misc/enchanted_item_glint' + ext;
			for (const name of ['entity', 'item'])
				if (pack.files.has(old))
					pack.set(root + `misc/enchanted_glint_${name}${ext}`, pack.files.get(old)!);
			pack.files.delete(old);
		}
	if (atLeast(target, '1.20'))
		withSheet(pack, root + 'gui/title/minecraft.png', 256, 256, (sheet) => {
			const output = sheet.canvas(274, 64);
			sheet.copy(output, 0, 0, 156, 44);
			sheet.copy(output, 0, 45, 119, 45, 155, 0);
			savePng(pack, root + 'gui/title/minecraft.png', output);
		});
}

export function finishInventory(pack: Pack): void {
	const path = 'assets/minecraft/textures/gui/container/inventory.png';
	withSheet(pack, path, 256, 256, (sheet) => {
		const output = { ...sheet.image, data: sheet.image.data.slice() };
		sheet.copy(output, 0, 166, 16, 32, 0, 198);
		sheet.copy(output, 104, 166, 16, 32, 16, 198);
		savePng(pack, path, output);
	});
}
