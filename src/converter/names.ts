import blocks from './data/blocks.json';
import items from './data/items.json';
import entities from './data/entities.json';
import { atLeast, type Target } from './versions';
import type { Pack } from './pack';

type Tables = Record<string, Record<string, string>>;
const blockTables: Tables = blocks;
const itemTables: Tables = items;
const stages = ['1_13', '1_14', '1_17', '1_19', '1_20_3'];
const clean = (value: string) => value.toLowerCase().replace(/[()]/g, '').replaceAll(' ', '_');

export function mapName(
  name: string,
  kind: 'block' | 'item',
  target: Target,
  model = false,
): string {
  let mapped = clean(name);
  for (const stage of stages) {
    if (!atLeast(target, stage.replaceAll('_', '.'))) continue;
    if (model && kind === 'item' && stage === '1_13')
      mapped = blockTables[stage]?.[mapped] ?? mapped;
    mapped = (kind === 'block' ? blockTables : itemTables)[stage]?.[mapped] ?? mapped;
  }
  if (atLeast(target, '1.14') && kind === 'item' && mapped === 'sign') mapped = 'oak_sign';
  if (
    atLeast(target, '26.2') &&
    kind === 'block' &&
    ['quartz_pillar', 'purpur_pillar'].includes(mapped) &&
    !model
  )
    mapped += '_side';
  return mapped;
}

export function resource(
  value: string,
  kind: 'texture' | 'model',
  target: Target,
  blockDefault = false,
): string {
  if (value.startsWith('#')) return value;
  let [namespace, path] = value.includes(':') ? value.split(':', 2) : ['minecraft', value];
  if (namespace !== 'minecraft') return value;
  path = clean(path);
  if (blockDefault && !/^(block|blocks)\//.test(path)) path = `block/${path}`;
  const match = /^(block|blocks|item|items)\/(.+)$/.exec(path);
  if (match && !match[2].startsWith('rpc_legacy_templates/')) {
    const category = match[1].startsWith('block') ? 'block' : 'item';
    const folder = atLeast(target, '1.13')
      ? category
      : kind === 'texture'
        ? `${category}s`
        : category;
    path = `${folder}/${mapName(match[2], category, target, kind === 'model')}`;
  }
  return value.includes(':') || atLeast(target, '1.19.3') ? `${namespace}:${path}` : path;
}

export function renameFiles(pack: Pack, target: Target): void {
  // Compute every destination from the original names before moving. This avoids
  // cascading grass -> grass_block / tall_grass -> grass mappings.
  const original = [...pack.files];
  const destinations = new Map<string, string>();
  for (const [path] of original) {
    if (!path.startsWith('assets/minecraft/')) continue;
    let next = path.split('/').map(clean).join('/');
    if (atLeast(target, '1.13')) {
      next = next.replace(
        /\/(textures|models)\/(blocks|items)\//,
        (_, type: string, folder: string) => `/${type}/${folder.slice(0, -1)}/`,
      );
      next = next.replace('/mcpatcher/', '/optifine/');
      const match =
        /^(assets\/minecraft\/)(textures\/(block|item)\/|models\/(block|item)\/|blockstates\/)([^/]+?)(\.png(?:\.mcmeta)?|\.json)$/.exec(
          next,
        );
      if (match) {
        let name = mapName(
          match[5],
          (match[3] ?? match[4] ?? 'block') as 'block' | 'item',
          target,
          !match[3],
        );
        if (match[5] === 'snow_layer' && match[6] === '.json') name = 'snow';
        next = match[1] + match[2] + name + match[6];
      }
      next = next.replace(
        /(\/textures\/entity\/(?:.*\/)?)([^/]+?)(\.png(?:\.mcmeta)?)$/,
        (_, prefix: string, name: string, ext: string) =>
          prefix + ((entities['*'] as Record<string, string>)[name] ?? name) + ext,
      );
      next = next.replace('/entity/endercrystal/', '/entity/end_crystal/');
      if (atLeast(target, '1.15'))
        next = next.replace('/entity/iron_golem.png', '/entity/iron_golem/iron_golem.png');
      if (atLeast(target, '1.17'))
        next = next.replace('/entity/squid.png', '/entity/squid/squid.png');
    }
    destinations.set(path, next);
  }
  for (const [from, to] of destinations) if (from !== to) pack.files.delete(from);
  for (const [from, bytes] of original) {
    const to = destinations.get(from);
    if (!to || from === to) continue;
    if (pack.files.has(to)) {
      pack.preserve(from, bytes);
      pack.warn(`Two legacy files map to ${to}. The other file is under converter_legacy.`);
    } else {
      pack.files.set(to, bytes);
      pack.report.renamed++;
    }
  }
  if (atLeast(target, '1.14')) {
    for (const [dye, originalName] of [
      ['black_dye', 'ink_sac'],
      ['brown_dye', 'cocoa_beans'],
      ['white_dye', 'bone_meal'],
      ['blue_dye', 'lapis_lazuli'],
    ]) {
      for (const directory of ['textures/item', 'models/item']) {
        for (const ext of directory.startsWith('textures') ? ['.png', '.png.mcmeta'] : ['.json']) {
          const source = `assets/minecraft/${directory}/${dye}${ext}`;
          const dest = `assets/minecraft/${directory}/${originalName}${ext}`;
          if (pack.files.has(source) && !pack.files.has(dest))
            pack.set(dest, pack.files.get(source)!);
        }
      }
    }
  }
}
