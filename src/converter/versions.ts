export const TARGETS = [
  { id: '26.3', format: [97, 1], level: 12603 },
  { id: '26.2', format: [88, 0], level: 12602 },
  { id: '26.1', format: [84, 0], level: 12601 },
  { id: '1.21.11', format: [75, 0], level: 12111 },
  { id: '1.20.6', format: [32, 0], level: 12006 },
  { id: '1.19.4', format: [13, 0], level: 11904 },
  { id: '1.16.5', format: [6, 0], level: 11605 },
  { id: '1.12.2', format: [3, 0], level: 11202 },
] as const;

export type TargetVersion = (typeof TARGETS)[number]['id'];
export type SourceVersion = '1.7' | '1.8';
export type Target = (typeof TARGETS)[number];

// Chronological ranks keep the 2026 numbering separate from 1.x patch numbers.
export function atLeast(target: Target, version: string): boolean {
  const ranks: Record<string, number> = {
    '1.9': 10900,
    '1.13': 11300,
    '1.14': 11400,
    '1.15': 11500,
    '1.17': 11700,
    '1.18': 11800,
    '1.19': 11900,
    '1.19.3': 11903,
    '1.19.4': 11904,
    '1.20': 12000,
    '1.20.2': 12002,
    '1.20.3': 12003,
    '1.20.5': 12005,
    '1.21.2': 12102,
    '1.21.4': 12104,
    '1.21.5': 12105,
    '1.21.11': 12111,
    '26.1': 12601,
    '26.2': 12602,
    '26.3': 12603,
  };
  return target.level >= ranks[version];
}

export function getTarget(id: string): Target {
  const target = TARGETS.find((entry) => entry.id === id);
  if (!target) throw new Error('Choose one of the supported target versions.');
  return target;
}
