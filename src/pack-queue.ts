import { LIMITS } from './converter/pack';
import type { DetectionResult } from './converter/detect';
import type { ConversionReport, WorkerResponse } from './converter/types';
import type { SourceVersion, TargetVersion } from './converter/versions';

export type PackState =
	| 'queued'
	| 'inspecting'
	| 'ready'
	| 'inspection-failed'
	| 'invalid'
	| 'blocked'
	| 'converting'
	| 'done'
	| 'error';

export type SelectedPack = {
	id: number;
	file: File;
	state: PackState;
	source: SourceVersion;
	confident: boolean;
	overrode: boolean;
	detection?: DetectionResult;
	detail?: string;
	progress: number;
	stage: string;
	url?: string;
	report?: ConversionReport;
	outputName?: string;
};

type Job = { worker: Worker; pack: SelectedPack; kind: 'detect' | 'convert' };

export class PackQueue {
	packs: SelectedPack[] = [];
	converting = false;
	message = '';
	batchTotal = 0;
	batchFinished = 0;
	private nextId = 0;
	private job?: Job;
	private pending: SelectedPack[] = [];
	private target: TargetVersion = '26.3';

	constructor(private readonly onChange: () => void) {}

	get activePack(): SelectedPack | undefined {
		return this.job?.pack;
	}

	get inspecting(): boolean {
		return this.packs.some((pack) => pack.state === 'queued' || pack.state === 'inspecting');
	}

	get hasResults(): boolean {
		return this.packs.some((pack) => pack.state === 'done');
	}

	get readyPacks(): SelectedPack[] {
		return this.packs.filter((pack) => pack.state === 'ready' || pack.state === 'error');
	}

	replace(files: File[]): void {
		if (this.converting || !files.length) return;
		this.dispose();
		this.message = '';
		this.packs = files.map((file) => {
			const detail = !/\.zip$/i.test(file.name)
				? "That file isn't a ZIP. Choose a .zip Minecraft resource pack."
				: file.size > LIMITS.zip
					? 'This ZIP is too large (over 256 MB). Pick a pack under 256 MB.'
					: file.size < 22
						? 'This ZIP file is empty or incomplete. Choose a valid pack.'
						: undefined;
			return {
				id: this.nextId++,
				file,
				state: detail ? 'invalid' : 'queued',
				source: '1.8',
				confident: false,
				overrode: false,
				detail,
				progress: 0,
				stage: 'Opening your pack',
			};
		});
		this.onChange();
		this.advance();
	}

	clear(): void {
		this.dispose();
		this.packs = [];
		this.message = '';
		this.onChange();
	}

	remove(pack: SelectedPack): void {
		if (this.converting) return;
		if (this.job?.pack === pack) this.stopWorker();
		if (pack.url) URL.revokeObjectURL(pack.url);
		this.packs = this.packs.filter((entry) => entry !== pack);
		this.message = '';
		this.onChange();
		this.advance();
	}

	override(pack: SelectedPack): void {
		if (this.converting || !this.readyPacks.includes(pack)) return;
		pack.source = pack.source === '1.8' ? '1.7' : '1.8';
		pack.overrode = true;
		pack.state = 'ready';
		pack.detail = undefined;
		this.onChange();
	}

	retryInspection(pack: SelectedPack): void {
		if (this.converting || pack.state !== 'inspection-failed' || !this.packs.includes(pack)) return;
		pack.state = 'queued';
		pack.detail = undefined;
		this.message = '';
		this.onChange();
		this.advance();
	}

	convert(target: TargetVersion): void {
		if (this.converting || this.inspecting || !this.readyPacks.length) return;
		this.target = target;
		this.pending = this.readyPacks;
		this.batchTotal = this.pending.length;
		this.batchFinished = 0;
		this.message = '';
		this.converting = true;
		this.advance();
	}

	cancel(): void {
		if (!this.converting) return;
		if (this.job) {
			this.job.pack.state = 'ready';
			this.job.pack.progress = 0;
		}
		this.stopWorker();
		this.pending = [];
		this.converting = false;
		this.message = this.hasResults
			? 'Conversion cancelled. Completed packs are still available to download.'
			: 'Conversion cancelled.';
		this.onChange();
	}

	dispose(): void {
		this.stopWorker();
		this.pending = [];
		this.converting = false;
		for (const pack of this.packs) if (pack.url) URL.revokeObjectURL(pack.url);
	}

	private stopWorker(): void {
		const worker = this.job?.worker;
		this.job = undefined;
		worker?.terminate();
	}

	private advance(): void {
		if (this.job) return;
		const next = this.converting
			? this.pending.shift()
			: this.packs.find((pack) => pack.state === 'queued');
		if (!next) {
			this.converting = false;
			this.onChange();
			return;
		}
		this.run(next, this.converting ? 'convert' : 'detect');
	}

	private fail(pack: SelectedPack, kind: Job['kind'], message: string): void {
		this.stopWorker();
		pack.state = kind === 'detect' ? 'inspection-failed' : 'error';
		pack.detail = message;
		if (kind === 'convert') this.batchFinished++;
		this.onChange();
		// A blocked worker can fail synchronously for every selected file.
		queueMicrotask(() => this.advance());
	}

	private run(pack: SelectedPack, kind: Job['kind']): void {
		pack.state = kind === 'detect' ? 'inspecting' : 'converting';
		pack.detail = undefined;
		pack.progress = 0;
		pack.stage = 'Opening your pack';
		try {
			const worker = new Worker(new URL('./converter/worker.ts', import.meta.url), {
				type: 'module',
			});
			this.job = { worker, pack, kind };
			worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
				if (this.job?.worker !== worker) return;
				const message = event.data;
				if (message.type === 'progress' && kind === 'convert') {
					pack.progress = message.progress.percent;
					pack.stage = message.progress.stage;
					this.onChange();
					return;
				}
				if (message.type === 'error') {
					this.fail(pack, kind, message.message);
					return;
				}
				if (message.type === 'detected' && kind === 'detect') {
					pack.detection = message.result;
					if (message.result.status === 'supported') {
						pack.source = message.result.version;
						pack.confident = message.result.confident;
						pack.state = 'ready';
					} else {
						pack.state = message.result.status === 'modern' ? 'blocked' : 'invalid';
						pack.detail = message.result.detail;
					}
				} else if (message.type === 'done' && kind === 'convert') {
					try {
						pack.url = URL.createObjectURL(new Blob([message.zip], { type: 'application/zip' }));
						pack.report = message.report;
						pack.outputName = `${pack.file.name.replace(/\.zip$/i, '')}-${this.target}.zip`;
						pack.state = 'done';
						pack.progress = 100;
						this.batchFinished++;
					} catch {
						this.fail(
							pack,
							kind,
							'Could not prepare the download. Try converting this pack again.',
						);
						return;
					}
				} else return;
				this.stopWorker();
				this.onChange();
				this.advance();
			};
			worker.onerror = () => {
				if (this.job?.worker !== worker) return;
				this.fail(
					pack,
					kind,
					kind === 'detect'
						? "Couldn't inspect this pack. Try again or choose another ZIP."
						: "Couldn't convert this pack. Try again or choose another ZIP.",
				);
			};
			this.onChange();
			worker.postMessage(
				kind === 'detect'
					? { type: 'detect', file: pack.file }
					: { type: 'convert', file: pack.file, source: pack.source, target: this.target },
			);
		} catch {
			this.fail(
				pack,
				kind,
				kind === 'detect'
					? 'Could not start pack inspection. Try again or open this in a current browser.'
					: 'Could not start conversion. Try again or open this in a current browser.',
			);
		}
	}
}
