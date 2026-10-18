import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';
import { isObject, type ConversionReport, type JsonObject } from './types';
import type { SourceVersion, TargetVersion } from './versions';

export const LIMITS = {
	zip: 256 * 1024 * 1024,
	expanded: 512 * 1024 * 1024,
	files: 30000,
	entry: 256 * 1024 * 1024,
};

function safePath(path: string): string {
	const clean = path.replaceAll('\\', '/');
	if (
		clean.startsWith('/') ||
		/^[a-z]:/i.test(clean) ||
		clean.split('/').some((part) => part === '..') ||
		clean.includes('\0')
	) {
		throw new Error(
			'This ZIP contains an unsafe file path. Re-create the ZIP from the resource pack folder.',
		);
	}
	return clean.replace(/^(\.\/)+/, '');
}

export class Pack {
	readonly files = new Map<string, Uint8Array>();
	readonly report: ConversionReport;
	private readonly notices = new Set<string>();

	constructor(data: Uint8Array, source: SourceVersion, target: TargetVersion) {
		if (data.length > LIMITS.zip) throw new Error('Choose a ZIP smaller than 256 MB.');
		let expanded = 0;
		let count = 0;
		let entries: Unzipped;
		try {
			entries = unzipSync(data, {
				filter(entry) {
					safePath(entry.name);
					expanded += entry.originalSize;
					if (
						++count > LIMITS.files ||
						entry.originalSize > LIMITS.entry ||
						expanded > LIMITS.expanded
					) {
						throw new Error(
							'This pack exceeds the browser limit of 30,000 files or 512 MB when unpacked.',
						);
					}
					return !entry.name.endsWith('/');
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : '';
			if (/limit|unsafe|exceeds/.test(message)) throw error;
			throw new Error(
				'This file could not be opened as a ZIP. Choose an unencrypted Java Edition resource pack.',
			);
		}
		const normalized = new Map<string, Uint8Array>();
		for (const [path, bytes] of Object.entries(entries)) {
			const clean = safePath(path);
			if (clean.startsWith('__MACOSX/') || clean.endsWith('/.DS_Store') || clean === '.DS_Store')
				continue;
			if (normalized.has(clean)) throw new Error(`The ZIP contains duplicate paths: ${clean}`);
			normalized.set(clean, bytes);
		}
		const roots = [...normalized.keys()].filter((path) => /(^|\/)pack\.mcmeta$/i.test(path));
		const candidates = roots.filter((path) => {
			const root = path.slice(0, -'pack.mcmeta'.length);
			return [...normalized.keys()].some((name) =>
				name.toLowerCase().startsWith(`${root.toLowerCase()}assets/`),
			);
		});
		const rootMeta = candidates.includes('pack.mcmeta')
			? 'pack.mcmeta'
			: candidates.length === 1
				? candidates[0]
				: undefined;
		if (!rootMeta)
			throw new Error(
				candidates.length > 1
					? 'This ZIP contains several packs. Choose a ZIP with just one resource pack.'
					: 'No Java resource pack found. The ZIP must contain pack.mcmeta and an assets folder.',
			);
		const root = rootMeta.slice(0, -'pack.mcmeta'.length);
		for (const [path, bytes] of normalized) {
			if (!path.startsWith(root)) continue;
			let relative = path.slice(root.length).replace(/^assets\/minecraft\//i, 'assets/minecraft/');
			if (/^pack\.(mcmeta|png)$/i.test(relative)) relative = relative.toLowerCase();
			this.files.set(relative, bytes);
		}
		this.report = {
			source,
			target,
			inputFiles: this.files.size,
			outputFiles: 0,
			renamed: 0,
			updated: 0,
			generated: 0,
			archived: 0,
			warnings: [],
		};
		const meta = this.json('pack.mcmeta', true)!;
		if (!isObject(meta.pack) || meta.pack.pack_format !== 1)
			throw new Error(
				'This converter accepts Minecraft Java 1.7 and 1.8 packs with pack_format 1.',
			);
		if (meta.overlays)
			throw new Error('Flatten pack overlays into a single pack before converting.');
		if (source === '1.7' && this.paths().some((p) => /\/models\/.*\.json$/.test(p))) {
			this.warn(
				'This pack contains models, which Minecraft 1.7 does not use. Choose 1.8 if the pack was made for 1.8.',
			);
		}
	}

	paths(prefix = ''): string[] {
		return [...this.files.keys()].filter((p) => p.startsWith(prefix));
	}
	text(path: string): string {
		return strFromU8(this.files.get(path)!);
	}
	json(path: string, required = false): JsonObject | undefined {
		if (!this.files.has(path)) return;
		try {
			const parsed: unknown = JSON.parse(this.text(path).replace(/^\uFEFF/, ''));
			if (!isObject(parsed)) throw new Error();
			return parsed;
		} catch {
			if (required) throw new Error(`${path} must contain a valid JSON object.`);
			this.archive(path);
			this.warn(`Invalid JSON was preserved under converter_legacy: ${path}`);
		}
	}
	set(path: string, bytes: Uint8Array): void {
		this.report[this.files.has(path) ? 'updated' : 'generated']++;
		this.files.set(path, bytes);
	}
	write(path: string, value: unknown): void {
		this.set(path, strToU8(JSON.stringify(value, null, 2) + '\n'));
	}
	move(from: string, to: string): void {
		if (from === to || !this.files.has(from)) return;
		if (this.files.has(to)) {
			this.archive(from);
			this.warn(
				`Kept an existing destination file and preserved the conflicting legacy file: ${to}`,
			);
			return;
		}
		this.files.set(to, this.files.get(from)!);
		this.files.delete(from);
		this.report.renamed++;
	}
	archive(path: string): void {
		if (!this.files.has(path)) return;
		this.preserve(path, this.files.get(path)!);
		this.files.delete(path);
	}
	preserve(path: string, bytes: Uint8Array): void {
		let backup = `converter_legacy/${path}`;
		let index = 2;
		while (this.files.has(backup)) backup = `converter_legacy/${index++}/${path}`;
		this.files.set(backup, bytes);
		this.report.archived++;
	}
	warn(message: string): void {
		this.notices.add(message);
	}
	finish(): { zip: Uint8Array<ArrayBuffer>; report: ConversionReport } {
		this.report.warnings = [...this.notices];
		this.report.outputFiles = this.files.size + (this.files.has('conversion-report.json') ? 0 : 1);
		this.files.set('conversion-report.json', strToU8(JSON.stringify(this.report, null, 2) + '\n'));
		const output: Unzipped = Object.create(null) as Unzipped;
		let size = 0;
		for (const [path, bytes] of this.files) {
			size += bytes.byteLength;
			if (size > LIMITS.expanded)
				throw new Error('The converted pack exceeds the 512 MB browser limit. Try a smaller pack.');
			output[path] = new Uint8Array(bytes);
		}
		return { zip: new Uint8Array(zipSync(output, { level: 6 })), report: this.report };
	}
}
