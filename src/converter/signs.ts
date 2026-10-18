// Sign layout coordinates adapted from Mojang/slicer, MIT licensed.
// https://github.com/Mojang/slicer/tree/main/26.2
import type { Pack } from './pack';
import { savePng, withSheet } from './images';
import { atLeast, type Target } from './versions';

export function convertSigns(pack: Pack, target: Target): void {
  for (const path of pack.paths('assets/').filter((p) => p.endsWith('/textures/entity/sign.png'))) {
    if (!atLeast(target, '1.14')) continue;
    const root = path.slice(0, -'entity/sign.png'.length);
    pack.move(path, root + 'entity/signs/oak.png');
    pack.move(path + '.mcmeta', root + 'entity/signs/oak.png.mcmeta');
  }
  if (!atLeast(target, '26.2')) return;
  for (const path of pack
    .paths('assets/')
    .filter((p) => /\/textures\/entity\/signs\/[^/]+\.png$/.test(p))) {
    const root = path.slice(0, path.indexOf('/textures/') + '/textures/'.length);
    const wood = path.split('/').at(-1)!.slice(0, -4);
    withSheet(pack, path, 64, 32, (sheet) => {
      const gui = sheet.canvas(24, 26);
      sheet.copy(gui, 2, 2, 24, 12, 0, 0);
      sheet.copy(gui, 2, 16, 2, 14, 11, 12);
      savePng(pack, root + `gui/signs/${wood}.png`, gui);
      const block = sheet.canvas(32, 32);
      const pieces: [number, number, number, number, number, number, ('y' | 'xy')?][] = [
        [2, 0, 24, 14, 0, 0],
        [26, 2, 2, 12, 24, 2],
        [28, 2, 24, 12, 0, 16],
        [0, 2, 2, 12, 24, 16],
        [26, 0, 24, 2, 0, 28, 'y'],
        [2, 16, 4, 14, 28, 0],
        [6, 16, 2, 14, 28, 16],
        [0, 16, 2, 14, 30, 16],
        [4, 14, 2, 2, 28, 30, 'y'],
      ];
      for (const [x, y, w, h, dx, dy, flip] of pieces) sheet.copy(block, x, y, w, h, dx, dy, flip);
      savePng(pack, root + `block/${wood}_sign.png`, block);
      pack.archive(path);
      pack.archive(path + '.mcmeta');
    });
  }
}
