import type { Pack } from './pack';
import { isObject, type Json, type JsonObject } from './types';
import { atLeast, type Target } from './versions';

const NON_MOB = new Set(
	'armorstand banner banner_base beacon beacon_beam bed bell boat chest chest_boat conduit decorated_pot elytra enchantment enchanting_table_book end_crystal endercrystal end_gateway_beam end_portal experience experience_orb explosion fishing fishing_hook lead_knot minecart player alex steve projectiles arrow spectral_arrow tipped_arrow shield shield_base shield_base_nopattern sign signs trident trident_riptide'.split(
		' ',
	),
);
const PLAYER_EQUIPMENT = new Set(['humanoid', 'humanoid_baby', 'humanoid_leggings', 'wings']);

function pair(pack: Pack, from: string, to: string): void {
	for (const extension of ['.png', '.png.mcmeta']) pack.move(from + extension, to + extension);
}

export function modernAssets(pack: Pack, target: Target): void {
	const namespaces = new Set(pack.paths('assets/').map((p) => p.split('/')[1]));
	for (const namespace of namespaces) {
		const root = `assets/${namespace}/`;
		const textures = root + 'textures/';
		const oldBeds = pack
			.paths(textures + (atLeast(target, '1.13') ? 'block/' : 'blocks/'))
			.filter((p) => /\/bed_(head|feet)_.*\.png(?:\.mcmeta)?$/.test(p));
		for (const path of oldBeds) pack.archive(path);
		if (oldBeds.length)
			pack.warn(
				'Pre-1.12 bed textures need a manual layout port. Originals are under converter_legacy; beds use vanilla artwork.',
			);
		if (atLeast(target, '1.14')) {
			const horses = pack.paths(textures + 'entity/horse/');
			for (const path of horses) pack.archive(path);
			if (horses.length)
				pack.warn(
					'Old horse skins and horse armor use incompatible geometry. Originals are under converter_legacy; horses use vanilla textures.',
				);
		}
		if (atLeast(target, '1.21.2')) {
			for (const material of [
				'chainmail',
				'diamond',
				'gold',
				'iron',
				'leather',
				'netherite',
				'turtle',
			])
				for (const layer of [1, 2]) {
					const folder = layer === 1 ? 'humanoid' : 'humanoid_leggings';
					pair(
						pack,
						textures + `models/armor/${material}_layer_${layer}`,
						textures +
							`entity/equipment/${folder}/${material === 'turtle' ? 'turtle_scute' : material}`,
					);
					if (material === 'leather')
						pair(
							pack,
							textures + `models/armor/leather_layer_${layer}_overlay`,
							textures + `entity/equipment/${folder}/leather_overlay`,
						);
				}
			pair(pack, textures + 'entity/elytra', textures + 'entity/equipment/wings/elytra');
		}
		if (atLeast(target, '1.21.5')) {
			for (const path of [...pack.paths(root + 'shaders/'), ...pack.paths(root + 'post_effect/')])
				pack.archive(path);
			if (pack.paths(`converter_legacy/${root}`).some((p) => /\/(shaders|post_effect)\//.test(p)))
				pack.warn(
					'Legacy shaders are incompatible with the modern renderer. Originals are under converter_legacy; the pack uses vanilla effects.',
				);
		}
		if (!atLeast(target, '26.1')) continue;
		const entityNames: Record<string, string> = {
			'armorstand/wood': 'armorstand/armorstand',
			banner_base: 'banner/banner_base',
			beacon_beam: 'beacon/beacon_beam',
			enchanting_table_book: 'enchantment/enchanting_table_book',
			end_gateway_beam: 'end_portal/end_gateway_beam',
			end_portal: 'end_portal/end_portal',
			experience_orb: 'experience/experience_orb',
			fishing_hook: 'fishing/fishing_hook',
			shield_base: 'shield/shield_base',
			shield_base_nopattern: 'shield/shield_base_nopattern',
			trident_riptide: 'trident/trident_riptide',
			'projectiles/spectral': 'projectiles/arrow_spectral',
			'projectiles/tipped': 'projectiles/arrow_tipped',
		};
		for (const name of ['lead_knot', 'minecart', 'trident']) entityNames[name] = `${name}/${name}`;
		for (const [from, to] of Object.entries(entityNames))
			pair(pack, textures + 'entity/' + from, textures + 'entity/' + to);
		let archived = 0;
		for (const prefix of [
			textures + 'entity/',
			root + 'optifine/random/entity/',
			root + 'optifine/mob/',
		]) {
			for (const path of pack.paths(prefix)) {
				const relative = path.slice(prefix.length).split('/');
				const category = relative[0].split('.')[0];
				if (
					NON_MOB.has(category) ||
					(category === 'equipment' && PLAYER_EQUIPMENT.has(relative[1]))
				)
					continue;
				if (
					category === 'shulker' &&
					prefix === textures + 'entity/' &&
					/\.png(?:\.mcmeta)?$/.test(path)
				) {
					const texture = path.slice(prefix.length);
					pack.set(textures + 'converter_block_entities/' + texture, pack.files.get(path)!);
					if (path.endsWith('.png'))
						addAtlasSource(pack, 'shulker_boxes', {
							type: 'minecraft:single',
							resource: `${namespace}:converter_block_entities/${texture.slice(0, -4)}`,
							sprite: `${namespace}:entity/${texture.slice(0, -4)}`,
						});
				}
				pack.archive(path);
				archived++;
			}
		}
		if (archived)
			pack.warn(
				'Mob skins are preserved under converter_legacy. This target uses vanilla mobs to avoid broken legacy UV layouts. Player armor and block-entity artwork are retained.',
			);
	}
	if (atLeast(target, '1.18')) {
		const root = 'assets/minecraft/particles/';
		if (pack.files.has(root + 'barrier.json'))
			pack.move(root + 'barrier.json', root + 'block_marker.json');
		else pack.move(root + 'light.json', root + 'block_marker.json');
	}
	if (atLeast(target, '26.3'))
		for (const path of pack.paths('assets/').filter((p) => /\/models\/.+\.json$/.test(p))) {
			const model = pack.json(path);
			if (!model) continue;
			if (Array.isArray(model.elements))
				for (const element of model.elements)
					if (isObject(element) && 'shade' in element) {
						if (element.shade === false) element.shade_direction_override = 'up';
						delete element.shade;
					}
			pack.write(path, model);
		}
}

export function addAtlasSource(pack: Pack, name: string, source: JsonObject): void {
	const path = `assets/minecraft/atlases/${name}.json`;
	const atlas = pack.json(path) ?? { sources: [] };
	if (!Array.isArray(atlas.sources)) atlas.sources = [];
	if (!atlas.sources.some((s) => JSON.stringify(s) === JSON.stringify(source)))
		atlas.sources.push(source);
	pack.write(path, atlas);
}

export function convertAtlases(pack: Pack, target: Target): void {
	if (!atLeast(target, '1.19.3')) return;
	const modern = atLeast(target, '26.1');
	// Vanilla already supplies its block and item directories. Only register
	// pack-specific texture references and directories to avoid duplicate sprites.
	const references = new Set<string>();
	for (const path of pack.paths('assets/').filter((p) => /\/models\/.+\.json$/.test(p))) {
		const model = pack.json(path);
		if (!model || !isObject(model.textures)) continue;
		for (const value of Object.values(model.textures)) {
			const sprite = isObject(value) ? value.sprite : value;
			if (typeof sprite === 'string' && !sprite.startsWith('#'))
				references.add(sprite.includes(':') ? sprite : `minecraft:${sprite}`);
		}
	}
	for (const reference of references) {
		if (
			reference.startsWith('minecraft:') &&
			/^(block|item|entity|trims)\//.test(reference.slice(10))
		)
			continue;
		addAtlasSource(pack, 'blocks', { type: 'minecraft:single', resource: reference });
		if (modern) addAtlasSource(pack, 'items', { type: 'minecraft:single', resource: reference });
	}
	if (modern) {
		const path = 'assets/minecraft/atlases/blocks.json';
		const atlas = pack.json(path);
		if (atlas && Array.isArray(atlas.sources)) {
			atlas.sources = atlas.sources.filter((source: Json) => {
				if (isObject(source) && source.source === 'item' && source.prefix === 'item/') {
					addAtlasSource(pack, 'items', source);
					return false;
				}
				return true;
			});
			pack.write(path, atlas);
		}
	}
}
