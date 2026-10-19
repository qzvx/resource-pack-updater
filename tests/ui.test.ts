import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerResponse, ConversionReport } from '../src/converter/types';

class TestElement {
	private identifier = '';
	get id() {
		return this.identifier;
	}
	set id(value: string) {
		this.identifier = value;
		elements.set(value, this);
	}
	hidden = false;
	disabled = false;
	textContent = '';
	value = '';
	checked = false;
	href = '';
	download = '';
	files: File[] = [];
	dataset = {};
	children: TestElement[] = [];
	classList = { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() };
	handlers = new Map<string, (event?: unknown) => void>();
	addEventListener(name: string, handler: (event?: unknown) => void): void {
		this.handlers.set(name, handler);
	}
	setAttribute = vi.fn();
	append(...children: TestElement[]): void {
		this.children.push(...children);
	}
	replaceChildren(...children: TestElement[]): void {
		this.children = children;
	}
	focus = vi.fn();
	click(): void {
		if (!this.disabled) this.handlers.get('click')?.();
	}
}

class TestWorker {
	static instances: TestWorker[] = [];
	static failConstruction = false;
	static failPosting = false;
	onmessage?: (event: MessageEvent<WorkerResponse>) => void;
	onerror?: () => void;
	terminate = vi.fn();
	postMessage = vi.fn((_message: unknown) => {
		if (TestWorker.failPosting) throw new Error('Could not post message');
	});
	constructor() {
		if (TestWorker.failConstruction) throw new Error('Worker unavailable');
		TestWorker.instances.push(this);
	}
	send(data: WorkerResponse): void {
		this.onmessage?.({ data } as MessageEvent<WorkerResponse>);
	}
}

let elements: Map<string, TestElement>;
const element = (id: string) => elements.get(id)!;
const latestWorker = () => TestWorker.instances.at(-1)!;
const makeFile = (name: string) => new File([new Uint8Array(64)], name);
function chooseFiles(...names: string[]): File[] {
	const files = names.map(makeFile);
	element('pack-file').files = files;
	element('pack-file').handlers.get('change')?.();
	return files;
}
function completeInspection(worker = latestWorker(), version: '1.7' | '1.8' = '1.7'): void {
	worker.send({ type: 'detected', result: { status: 'supported', version, confident: true } });
}
function completeConversion(worker = latestWorker(), warnings: string[] = []): void {
	const request = worker.postMessage.mock.calls.at(-1)![0] as {
		source: '1.7' | '1.8';
		target: '26.3';
	};
	const report: ConversionReport = {
		source: request.source,
		target: request.target,
		inputFiles: 2,
		outputFiles: 3,
		renamed: 1,
		updated: 1,
		generated: 0,
		archived: 0,
		warnings,
	};
	worker.send({ type: 'done', zip: new Uint8Array([1, 2, 3]), report });
}

beforeEach(async () => {
	vi.resetModules();
	TestWorker.instances = [];
	TestWorker.failConstruction = false;
	TestWorker.failPosting = false;
	elements = new Map();
	const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
	for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
		const node = new TestElement();
		node.hidden = /\bhidden\b/.test(match[0]);
		node.id = match[1];
	}
	vi.stubGlobal('document', {
		getElementById: (id: string) => elements.get(id),
		createElement: () => new TestElement(),
		querySelectorAll: () => [],
	});
	vi.stubGlobal('window', { addEventListener: vi.fn() });
	vi.stubGlobal('Worker', TestWorker);
	let nextUrl = 0;
	vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${nextUrl++}`);
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
	await import('../src/main');
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('pack inspection recovery', () => {
	it.each(['crash', 'message', 'construction', 'posting'])(
		'offers a retry after an inspection failure through %s',
		async (mode) => {
			TestWorker.failConstruction = mode === 'construction';
			TestWorker.failPosting = mode === 'posting';
			const [file] = chooseFiles('pack.zip');
			const initialWorker = latestWorker();
			if (mode === 'crash') initialWorker.onerror?.();
			if (mode === 'message') initialWorker.send({ type: 'error', message: 'Read failed' });
			await Promise.resolve();
			expect(element('convert').textContent).toBe('Retry inspection');
			expect(element('convert').disabled).toBe(false);
			expect(element('error').hidden).toBe(false);
			expect(element('detected-badge').textContent).toBe('Inspection failed');
			TestWorker.failConstruction = false;
			TestWorker.failPosting = false;
			element('convert').click();
			expect(latestWorker().postMessage).toHaveBeenCalledWith({ type: 'detect', file });
			expect(element('error').hidden).toBe(true);
			expect(element('convert').textContent).toBe('Inspecting...');
			completeInspection();
			expect(element('detected-badge').textContent).toBe('Detected: 1.7');
			element('convert').click();
			expect(latestWorker().postMessage).toHaveBeenCalledWith({
				type: 'convert',
				file,
				source: '1.7',
				target: '26.3',
			});
		},
	);

	it('keeps invalid ZIPs blocked and displays their error', () => {
		chooseFiles('pack.zip');
		latestWorker().send({
			type: 'detected',
			result: { status: 'corrupt', detail: 'Invalid archive' },
		});
		expect(element('convert').textContent).toBe('Choose a valid ZIP');
		expect(element('convert').disabled).toBe(true);
		expect(element('error-text').textContent).toBe('Invalid archive');
	});

	it.each(['remove', 'replace', 'reject'])(
		'ignores old inspection callbacks after %s',
		(action) => {
			chooseFiles('pack.zip');
			const oldWorker = latestWorker();
			if (action === 'remove') element('remove-file').click();
			else chooseFiles(action === 'replace' ? 'new.zip' : 'bad.txt');
			expect(oldWorker.terminate).toHaveBeenCalled();
			const previousText = element('error-text').textContent;
			oldWorker.send({ type: 'error', message: 'Stale error' });
			oldWorker.onerror?.();
			completeInspection(oldWorker);
			expect(element('error-text').textContent).toBe(previousText);
			if (action === 'replace') {
				expect(element('convert').textContent).toBe('Inspecting...');
				completeInspection();
				expect(element('convert').disabled).toBe(false);
			} else expect(element('convert').disabled).toBe(true);
		},
	);

	it('keeps conversion errors retryable without inspecting the pack again', async () => {
		chooseFiles('pack.zip');
		completeInspection();
		element('convert').click();
		latestWorker().send({ type: 'error', message: 'Conversion failed' });
		await Promise.resolve();
		expect(element('convert').textContent).toBe('Update pack →');
		expect(element('convert').disabled).toBe(false);
		expect(element('error-text').textContent).toBe('Conversion failed');
	});
});

describe('multiple packs', () => {
	it('downloads each completed pack separately and skips failed packs', async () => {
		chooseFiles('same.zip', 'same.zip', 'failed.zip');
		completeInspection();
		completeInspection();
		completeInspection();
		element('convert').click();
		completeConversion();
		expect(element('download-all').hidden).toBe(true);
		completeConversion();
		latestWorker().send({ type: 'error', message: 'Conversion failed' });
		await Promise.resolve();
		expect(element('download-all').hidden).toBe(false);
		const first = vi.spyOn(element('pack-0-download'), 'click');
		const second = vi.spyOn(element('pack-1-download'), 'click');
		const failed = vi.spyOn(element('pack-2-download'), 'click');
		element('download-all').click();
		expect(first).toHaveBeenCalledOnce();
		expect(second).toHaveBeenCalledOnce();
		expect(failed).not.toHaveBeenCalled();
		expect(element('pack-0-download').href).toBe('blob:test-0');
		expect(element('pack-1-download').href).toBe('blob:test-1');
		expect(element('pack-0-download').download).toBe('same-26.3.zip');
		expect(element('pack-1-download').download).toBe('same-26.3.zip');
		expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
		element('convert').click();
		completeConversion();
		element('download-all').click();
		expect(first).toHaveBeenCalledTimes(2);
		expect(second).toHaveBeenCalledTimes(2);
		expect(failed).toHaveBeenCalledOnce();
		expect(element('pack-2-download').download).toBe('failed-26.3.zip');
		expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
		element('start-again').click();
		expect(element('download-all').hidden).toBe(true);
		element('download-all').click();
		expect(first).toHaveBeenCalledTimes(2);
		expect(second).toHaveBeenCalledTimes(2);
		expect(failed).toHaveBeenCalledOnce();
	});

	it('downloads completed packs after cancelling without downloading unfinished packs', () => {
		chooseFiles('first.zip', 'second.zip', 'third.zip');
		completeInspection();
		completeInspection();
		completeInspection();
		element('convert').click();
		completeConversion();
		completeConversion();
		element('cancel').click();
		const first = vi.spyOn(element('pack-0-download'), 'click');
		const second = vi.spyOn(element('pack-1-download'), 'click');
		const unfinished = vi.spyOn(element('pack-2-download'), 'click');
		element('download-all').click();
		expect(first).toHaveBeenCalledOnce();
		expect(second).toHaveBeenCalledOnce();
		expect(unfinished).not.toHaveBeenCalled();
		expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
	});

	it('shows report links only for pack errors and hides them after recovery', async () => {
		chooseFiles('first.zip', 'second.zip');
		expect(element('pack-0-issue').hidden).toBe(true);
		completeInspection();
		completeInspection();
		expect(element('pack-0-issue').hidden).toBe(true);
		element('convert').click();
		expect(element('pack-0-issue').hidden).toBe(true);
		completeConversion();
		expect(element('pack-0-issue').hidden).toBe(true);
		latestWorker().send({ type: 'error', message: 'Conversion failed' });
		await Promise.resolve();
		expect(element('pack-1-issue').hidden).toBe(false);
		element('convert').click();
		completeConversion();
		expect(element('pack-1-issue').hidden).toBe(true);
	});

	it('does not treat cancellation as a reportable issue', () => {
		chooseFiles('pack.zip');
		completeInspection();
		element('convert').click();
		element('cancel').click();
		expect(element('error').hidden).toBe(false);
		expect(element('error-issue-link').hidden).toBe(true);
		element('convert').click();
		completeConversion();
		expect(element('download-all').hidden).toBe(true);
		expect(element('pack-0-issue').hidden).toBe(true);
	});

	it('applies the shared target while retaining each detected source version', () => {
		const files = chooseFiles('first.zip', 'second.zip');
		completeInspection(latestWorker(), '1.7');
		completeInspection(latestWorker(), '1.8');
		const radio = element('versions')
			.children.map((label) => label.children[0])
			.find((input) => input.value === '1.16.5')!;
		radio.checked = true;
		radio.handlers.get('change')?.();
		element('convert').click();
		expect(latestWorker().postMessage).toHaveBeenCalledWith({
			type: 'convert',
			file: files[0],
			source: '1.7',
			target: '1.16.5',
		});
		completeConversion();
		expect(latestWorker().postMessage).toHaveBeenCalledWith({
			type: 'convert',
			file: files[1],
			source: '1.8',
			target: '1.16.5',
		});
		completeConversion();
		expect(element('pack-0-download').download).toBe('first-1.16.5.zip');
		expect(element('pack-1-download').download).toBe('second-1.16.5.zip');
	});

	it('rejects oversized and incomplete files individually while keeping valid packs', () => {
		const oversized = makeFile('large.zip');
		Object.defineProperty(oversized, 'size', { value: 256 * 1024 * 1024 + 1 });
		element('pack-file').files = [oversized, new File([], 'empty.zip'), makeFile('good.zip')];
		element('pack-file').handlers.get('change')?.();
		expect(TestWorker.instances).toHaveLength(1);
		expect(element('pack-0-detail').textContent).toContain('too large');
		expect(element('pack-1-detail').textContent).toContain('empty or incomplete');
		completeInspection();
		expect(element('convert').textContent).toBe('Update 1 pack →');
	});

	it('ignores new selections and drops while a batch is converting', () => {
		chooseFiles('first.zip', 'second.zip');
		completeInspection();
		completeInspection();
		element('convert').click();
		const worker = latestWorker();
		chooseFiles('replacement.zip');
		element('drop-zone').handlers.get('drop')?.({
			preventDefault() {},
			dataTransfer: { files: [makeFile('dropped.zip')] },
		});
		expect(latestWorker()).toBe(worker);
		expect(worker.terminate).not.toHaveBeenCalled();
		completeConversion();
		completeConversion();
		expect(element('result-title').textContent).toBe('2 of 2 packs ready');
	});

	it('labels conversion notes with their pack names', () => {
		chooseFiles('first.zip', 'second.zip');
		completeInspection();
		completeInspection();
		element('convert').click();
		completeConversion(latestWorker(), ['Review beds']);
		completeConversion(latestWorker(), ['Review models']);
		expect(element('warning-list').children.map((note) => note.textContent)).toEqual([
			'first.zip: Review beds',
			'second.zip: Review models',
		]);
	});

	it.each(['select', 'drop'])(
		'accepts multiple packs through %s and converts each with its own source',
		(action) => {
			const files = ['first.zip', 'second.zip'].map(makeFile);
			if (action === 'select') {
				element('pack-file').files = files;
				element('pack-file').handlers.get('change')?.();
			} else {
				element('drop-zone').handlers.get('drop')?.({
					preventDefault() {},
					dataTransfer: { files },
				});
			}
			expect(TestWorker.instances).toHaveLength(1);
			expect(element('pack-list').hidden).toBe(false);
			expect(element('convert').disabled).toBe(true);
			completeInspection(latestWorker(), '1.7');
			expect(TestWorker.instances).toHaveLength(2);
			completeInspection(latestWorker(), '1.8');
			element('pack-1-override').click();
			expect(element('pack-1-status').textContent).toBe('Using: 1.7');
			element('convert').click();
			expect(latestWorker().postMessage).toHaveBeenCalledWith({
				type: 'convert',
				file: files[0],
				source: '1.7',
				target: '26.3',
			});
			expect(element('pack-file').disabled).toBe(true);
			expect(element('progress-stage').textContent).toContain('first.zip');
			completeConversion();
			expect(element('progress-stage').textContent).toContain('second.zip');
			expect(element('pack-0-download').download).toBe('first-26.3.zip');
			expect(latestWorker().postMessage).toHaveBeenCalledWith({
				type: 'convert',
				file: files[1],
				source: '1.7',
				target: '26.3',
			});
			completeConversion();
			expect(element('result-title').textContent).toBe('2 of 2 packs ready');
			expect(element('progress-section').hidden).toBe(true);
			expect(element('download').hidden).toBe(true);
			expect(element('pack-1-download').download).toBe('second-26.3.zip');
			expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
		},
	);

	it('continues after a conversion error and retries only failed packs', async () => {
		chooseFiles('first.zip', 'second.zip');
		completeInspection();
		completeInspection();
		element('convert').click();
		latestWorker().send({ type: 'error', message: 'Broken model' });
		await Promise.resolve();
		expect(element('pack-0-detail').textContent).toBe('Broken model');
		completeConversion();
		expect(element('result-title').textContent).toBe('1 of 2 packs ready');
		expect(element('convert').disabled).toBe(false);
		const savedUrl = element('pack-1-download').href;
		element('convert').click();
		completeConversion();
		expect(element('pack-1-download').href).toBe(savedUrl);
		expect(element('result-title').textContent).toBe('2 of 2 packs ready');
		expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
	});

	it('preserves completed downloads on cancel and resumes only remaining packs', () => {
		const files = chooseFiles('first.zip', 'second.zip', 'third.zip');
		completeInspection();
		completeInspection();
		completeInspection();
		element('convert').click();
		completeConversion();
		const cancelledWorker = latestWorker();
		cancelledWorker.send({
			type: 'progress',
			progress: { percent: 50, stage: 'Updating textures' },
		});
		expect(element('progress-percent').textContent).toBe('50%');
		element('cancel').click();
		expect(cancelledWorker.terminate).toHaveBeenCalled();
		expect(element('pack-0-download').hidden).toBe(false);
		expect(element('error-text').textContent).toContain('Completed packs are still available');
		completeConversion(cancelledWorker);
		expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
		element('convert').click();
		expect(latestWorker().postMessage).toHaveBeenCalledWith({
			type: 'convert',
			file: files[1],
			source: '1.7',
			target: '26.3',
		});
		completeConversion();
		completeConversion();
		expect(element('result-title').textContent).toBe('3 of 3 packs ready');
	});

	it('skips invalid and unsupported packs while converting supported packs', () => {
		chooseFiles('bad.txt', 'modern.zip', 'good.zip');
		latestWorker().send({
			type: 'detected',
			result: { status: 'modern', detail: 'Already modern' },
		});
		completeInspection();
		expect(element('convert').textContent).toBe('Update 1 pack →');
		expect(element('pack-0-detail').textContent).toContain("isn't a ZIP");
		expect(element('pack-1-detail').textContent).toBe('Already modern');
		element('convert').click();
		completeConversion();
		expect(element('result-title').textContent).toBe('1 of 3 packs ready');
	});

	it('continues inspection after a failure and supports retrying just that pack', async () => {
		chooseFiles('first.zip', 'second.zip');
		latestWorker().onerror?.();
		await Promise.resolve();
		completeInspection();
		expect(element('pack-0-retry').hidden).toBe(false);
		element('pack-0-retry').click();
		completeInspection();
		expect(element('convert').textContent).toBe('Update 2 packs →');
	});

	it('can remove the pack currently being inspected without accepting stale responses', () => {
		chooseFiles('first.zip', 'second.zip');
		const oldWorker = latestWorker();
		element('pack-0-remove').click();
		expect(oldWorker.terminate).toHaveBeenCalled();
		completeInspection(oldWorker);
		expect(element('convert').disabled).toBe(true);
		completeInspection();
		expect(element('file-name').textContent).toBe('second.zip');
		expect(element('convert').disabled).toBe(false);
	});

	it('releases download URLs when starting over', () => {
		chooseFiles('first.zip', 'second.zip');
		completeInspection();
		completeInspection();
		element('convert').click();
		completeConversion();
		completeConversion();
		element('start-again').click();
		expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
		expect(element('result').hidden).toBe(true);
		expect(element('pack-list').hidden).toBe(true);
		expect(element('pack-file').disabled).toBe(false);
	});
});
