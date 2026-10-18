import langData from './data/lang.json';
import type { Pack } from './pack';
import { isObject } from './types';
import { atLeast, type Target } from './versions';

function unescapeProperty(value: string): string {
  return value.replace(
    /\\u([a-f0-9]{4})|\\(.)/gi,
    (_, hex: string | undefined, char: string | undefined) =>
      hex
        ? String.fromCharCode(parseInt(hex, 16))
        : (({ n: '\n', r: '\r', t: '\t', f: '\f' } as Record<string, string>)[char!] ?? char!),
  );
}

export function convertMetadata(pack: Pack, target: Target): void {
  const json = pack.json('pack.mcmeta', true)!;
  if (!isObject(json.pack)) throw new Error('pack.mcmeta has no pack section.');
  delete json.pack.pack_format;
  delete json.pack.supported_formats;
  delete json.pack.min_format;
  delete json.pack.max_format;
  if (atLeast(target, '1.21.11')) {
    // A major-only maximum accepts every minor format. Use a pair for an
    // exact target, including 26.3's mandatory minor format 97.1.
    json.pack.min_format = [...target.format];
    json.pack.max_format = [...target.format];
  } else json.pack.pack_format = target.format[0];
  json.meta = { ...(isObject(json.meta) ? json.meta : {}), game_version: target.id };
  pack.write('pack.mcmeta', json);

  if (atLeast(target, '1.13')) {
    const mappings = { ...langData['1_13'], ...langData['1_14'] } as Record<string, string>;
    for (const path of pack.paths('assets/').filter((p) => /\/lang\/[^/]+\.lang$/.test(p))) {
      const entries: Record<string, string> = Object.create(null) as Record<string, string>;
      const lines = pack
        .text(path)
        .replace(/^\uFEFF/, '')
        .replace(/\\\r?\n[ \t]*/g, '')
        .split(/\r?\n/);
      for (const line of lines) {
        if (/^\s*[#!]/.test(line) || !line.trim()) continue;
        const match = /^\s*((?:\\.|[^=:\s])+)[\s]*[=:]?\s*(.*)$/.exec(line);
        if (!match) continue;
        const key = unescapeProperty(match[1]);
        entries[mappings[key] ?? key] = unescapeProperty(match[2]);
      }
      pack.write(path.replace(/\.lang$/, '.json'), entries);
      pack.files.delete(path);
    }
    for (const path of pack.paths('assets/').filter((p) => p.endsWith('/sounds.json'))) {
      const sounds = pack.json(path);
      if (!sounds) continue;
      const output = Object.fromEntries(
        Object.entries(sounds).map(([name, value]) => {
          if (isObject(value) && Array.isArray(value.sounds))
            value.sounds = value.sounds.map((sound) => {
              if (typeof sound === 'string') return sound.toLowerCase().replaceAll('\\', '/');
              if (isObject(sound) && typeof sound.name === 'string')
                sound.name = sound.name.toLowerCase().replaceAll('\\', '/');
              return sound;
            });
          return [name.toLowerCase(), value];
        }),
      );
      pack.write(path, output);
    }
  }
  if (pack.paths('assets/').some((p) => /\/(optifine|mcpatcher)\//.test(p)))
    pack.warn(
      'OptiFine and MCPatcher files are retained, but their custom features need a manual compatibility check.',
    );
}
