import defaultsData from './data/block_display_defaults_26_1.json';
import displayData from './data/display.json';
import selectorsData from './data/blockstate_selectors_26_1.json';
import { resource } from './names';
import type { Pack } from './pack';
import { isObject, type Json, type JsonObject } from './types';
import { atLeast, type Target } from './versions';

const defaults: Record<string, JsonObject> = defaultsData;
const selectors: Record<string, Record<string, string[]>> = selectorsData;
const modelId = (path: string) => path.replace(/^assets\/([^/]+)\/models\/(.+)\.json$/, '$1:$2');

export function preserveTemplates(pack: Pack, target: Target): void {
	if (!atLeast(target, '1.13')) return;
	const templates = new Set<string>();
	for (const path of pack.paths('assets/minecraft/models/block/')) {
		if (!/^assets\/minecraft\/models\/block\/[^/]+\.json$/.test(path)) continue;
		const json = pack.json(path);
		if (
			json?.elements &&
			(!isObject(json.textures) ||
				!Object.values(json.textures).some((t) => typeof t === 'string' && !t.startsWith('#')))
		)
			templates.add(modelId(path));
	}
	for (const path of pack.paths('assets/').filter((p) => /\/models\/.+\.json$/.test(p))) {
		const json = pack.json(path);
		if (!json) continue;
		if (
			typeof json.parent === 'string' &&
			templates.has(json.parent.includes(':') ? json.parent : `minecraft:${json.parent}`)
		)
			json.parent = json.parent.replace(
				/^(minecraft:)?block\//,
				'minecraft:block/rpc_legacy_templates/',
			);
		pack.write(path, json);
		if (templates.has(modelId(path)))
			pack.move(path, path.replace('/models/block/', '/models/block/rpc_legacy_templates/'));
	}
}

function vector(value: Json, multiply: number[], add: number[]): Json {
	return Array.isArray(value)
		? value.map((n, i) =>
				typeof n === 'number' ? Math.round((n * multiply[i] + add[i]) * 100000) / 100000 : n,
			)
		: value;
}

function updateDisplay(display: JsonObject): JsonObject {
	const out = structuredClone(display);
	for (const mode of ['firstperson', 'thirdperson'] as const) {
		const old = out[mode];
		if (isObject(old)) {
			const part = structuredClone(old);
			if (mode === 'firstperson') {
				if (part.rotation) part.rotation = vector(part.rotation, [1, 1, 1], [0, 45, 0]);
				if (part.translation)
					part.translation = vector(part.translation, [0.4, 0.4, 0.4], [1.13, 1.6, 0.33]);
				if (part.scale) part.scale = vector(part.scale, [0.4, 0.4, 0.4], [0, 0, 0]);
			} else {
				// 1.8 renders ordinary flat items with a different hand basis from tools.
				// Preserve their texture-specific offsets relative to the modern flat pose.
				const flat =
					Array.isArray(part.rotation) &&
					part.rotation.length === 3 &&
					part.rotation.every((n, i) => n === [-90, 0, 0][i]);
				if (part.rotation)
					part.rotation = vector(part.rotation, [1, -1, -1], flat ? [90, 0, 0] : [0, 0, 20]);
				if (part.translation)
					part.translation = vector(
						part.translation,
						flat ? [1, 1, 1] : [1, 1, -1],
						flat ? [0, 2, 4] : [0, 2.75, -3],
					);
			}
			out[`${mode}_righthand`] ??= part;
			delete out[mode];
		}
		out[`${mode}_righthand`] ??= structuredClone(displayData[`${mode}_righthand`]);
		if (!out[`${mode}_lefthand`]) {
			const left = structuredClone(out[`${mode}_righthand`]) as JsonObject;
			if (left.rotation) left.rotation = vector(left.rotation, [1, -1, -1], [0, 0, 0]);
			out[`${mode}_lefthand`] = left;
		}
	}
	out.ground ??= structuredClone(displayData.ground);
	out.head ??= structuredClone(displayData.head);
	return out;
}

function inheritsBlock(id: string, models: Map<string, JsonObject>): boolean {
	const seen = new Set<string>();
	while (!seen.has(id)) {
		seen.add(id);
		const parent = models.get(id)?.parent;
		if (typeof parent !== 'string') return false;
		if (/^(minecraft:)?block\//.test(parent)) return true;
		id = parent.includes(':') ? parent : `minecraft:${parent}`;
	}
	return false;
}

export function convertModels(pack: Pack, target: Target): void {
	const models = new Map<string, JsonObject>();
	const paths = pack.paths('assets/').filter((p) => /\/models\/.+\.json$/.test(p));
	for (const path of paths) {
		const json = pack.json(path);
		if (!json) continue;
		if (typeof json.parent === 'string') json.parent = resource(json.parent, 'model', target);
		if (
			/^(minecraft:)?builtin\/generated$/.test(String(json.parent)) &&
			modelId(path) !== 'minecraft:item/generated'
		)
			json.parent = 'minecraft:item/generated';
		if (isObject(json.textures)) {
			for (const [key, value] of Object.entries(json.textures)) {
				if (typeof value !== 'string') continue;
				const expanded =
					key === 'layer0' && !/[/:#]/.test(value)
						? `${path.includes('/models/item/') ? 'items' : 'blocks'}/${value}`
						: value;
				json.textures[key] = resource(expanded, 'texture', target);
			}
		}
		if (isObject(json.display)) json.display = updateDisplay(json.display);
		if (Array.isArray(json.overrides))
			for (const override of json.overrides) {
				if (isObject(override) && typeof override.model === 'string')
					override.model = resource(override.model, 'model', target);
			}
		models.set(modelId(path), json);
	}
	for (const path of paths) {
		const id = modelId(path),
			json = models.get(id);
		if (!json) continue;
		if (id.startsWith('minecraft:block/')) {
			if (json.elements && !json.parent && id !== 'minecraft:block/block')
				json.parent = 'minecraft:block/block';
			const settings =
				defaults[id.replace('minecraft:', '').replace('block/rpc_legacy_templates/', 'block/')];
			if (settings)
				for (const [key, value] of Object.entries(settings)) {
					if (key === 'parent' && json.parent && !json.elements) continue;
					json[key] = structuredClone(value);
				}
		} else if (inheritsBlock(id, models)) delete json.display;
		if (atLeast(target, '1.21.4') && /\/models\/item\//.test(path))
			modernItem(pack, path, json, target);
		pack.write(path, json);
	}
}

function modernItem(pack: Pack, path: string, json: JsonObject, target: Target): void {
	const id = modelId(path);
	const name = id.split(':')[1].slice('item/'.length);
	const basic = (model: string): JsonObject => ({ type: 'minecraft:model', model });
	const hadOverrides = Array.isArray(json.overrides);
	let tree: JsonObject = basic(id);
	const parent = typeof json.parent === 'string' ? json.parent.replace('minecraft:', '') : '';
	if (parent === 'builtin/entity') {
		const template = /^(chest|ender_chest|trapped_chest)$/.test(name)
			? 'chest'
			: /banner$/.test(name)
				? 'banner'
				: /skull|head/.test(name)
					? 'skull'
					: undefined;
		if (template && !json.elements) {
			json.parent = `minecraft:item/template_${template}`;
			delete json.display;
		}
		// Vanilla item definitions supply special rendering. Keeping them preserves
		// chests, banners and skulls instead of replacing them with a flat model.
		if (!json.elements) return;
	}
	if (name === 'bow' && !json.overrides) {
		const namespace = id.split(':')[0];
		const entries = [0, 1, 2].map((index) => ({
			threshold: [0, 0.65, 0.9][index],
			model: basic(`${namespace}:item/bow_pulling_${index}`),
		}));
		tree = {
			type: 'minecraft:condition',
			property: 'minecraft:using_item',
			on_false: tree,
			on_true: {
				type: 'minecraft:range_dispatch',
				property: 'minecraft:use_duration',
				scale: 0.05,
				fallback: basic(id),
				entries,
			},
		};
	}
	if (Array.isArray(json.overrides)) {
		const original = structuredClone(json.overrides);
		let unsupported = false;
		// Nest each predicate around the current tree in source order. Later
		// matching overrides win, including predicates with multiple conditions.
		for (const override of original) {
			if (
				!isObject(override) ||
				!isObject(override.predicate) ||
				typeof override.model !== 'string'
			) {
				unsupported = true;
				continue;
			}
			let branch: JsonObject = basic(override.model);
			let supported = true;
			for (const [property, threshold] of Object.entries(override.predicate).reverse()) {
				if (typeof threshold !== 'number') {
					supported = false;
					break;
				}
				const ranges: Record<string, string> = {
					damage: 'minecraft:damage',
					custom_model_data: 'minecraft:custom_model_data',
					pull: 'minecraft:use_duration',
					angle: 'minecraft:compass',
					time: 'minecraft:time',
				};
				if (Object.hasOwn(ranges, property)) {
					const dispatch: JsonObject = {
						type: 'minecraft:range_dispatch',
						property: ranges[property],
						fallback: tree,
						entries: [{ threshold, model: branch }],
					};
					if (property === 'pull') dispatch.scale = 0.05;
					if (property === 'angle') dispatch.target = 'spawn';
					if (property === 'time') dispatch.source = 'daytime';
					branch = dispatch;
				} else if (['pulling', 'blocking', 'damaged', 'lefthanded', 'cast'].includes(property)) {
					const condition = (
						{
							pulling: 'using_item',
							blocking: 'using_item',
							damaged: 'damaged',
							lefthanded: 'carried',
							cast: 'fishing_rod/cast',
						} as Record<string, string>
					)[property];
					if (property === 'lefthanded') {
						supported = false;
						break;
					}
					branch = {
						type: 'minecraft:condition',
						property: `minecraft:${condition}`,
						on_true: threshold > 0 ? branch : tree,
						on_false: threshold > 0 ? tree : branch,
					};
				} else {
					supported = false;
					break;
				}
			}
			if (supported) tree = branch;
			else unsupported = true;
		}
		if (unsupported) {
			pack.write(`converter_legacy/${path}`, { ...json, overrides: original });
			pack.warn(`Some model predicates require a manual port: ${path}`);
		}
		delete json.overrides;
	}
	const texture = isObject(json.textures) ? json.textures.layer0 : undefined;
	// Keep the target's vanilla dynamic definition when an old item only changes
	// its texture. It still references the converted model.
	if (
		!json.elements &&
		!hadOverrides &&
		/^(compass|clock|fishing_rod|shield|.*_spawn_egg|potion|splash_potion|lingering_potion|leather_.*|filled_map)$/.test(
			name,
		)
	) {
		if (texture && name === 'filled_map' && atLeast(target, '26.3'))
			pack.warn('26.3 uses separate map item artwork. Review custom filled-map models in game.');
		return;
	}
	pack.write(path.replace('/models/item/', '/items/'), { model: tree });
}

export function convertBlockstates(pack: Pack, target: Target): void {
	for (const path of pack.paths('assets/').filter((p) => /\/blockstates\/.+\.json$/.test(p))) {
		const json = pack.json(path);
		if (!json) continue;
		if (isObject(json.variants) && atLeast(target, '1.13') && json.variants.normal) {
			json.variants[''] = json.variants.normal;
			delete json.variants.normal;
		}
		function walk(value: Json): void {
			if (Array.isArray(value)) {
				for (const child of value) walk(child);
				return;
			}
			if (!isObject(value)) return;
			for (const [key, child] of Object.entries(value)) {
				if (key === 'model' && typeof child === 'string')
					value[key] = resource(child, 'model', target, true);
				else walk(child);
			}
		}
		walk(json);
		const schema = selectors[path.split('/').at(-1)!];
		if (
			atLeast(target, '1.13') &&
			schema &&
			isObject(json.variants) &&
			Object.keys(json.variants).some(
				(selector) =>
					selector !== '' &&
					selector.split(',').some((part) => {
						const [key, value] = part.split('=');
						return !schema[key]?.includes(value);
					}),
			)
		) {
			pack.archive(path);
			pack.warn(
				"Obsolete block-state selectors were preserved under converter_legacy. These blocks use the target game's vanilla state definitions.",
			);
		} else pack.write(path, json);
	}
}
