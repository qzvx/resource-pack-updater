import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerResponse } from '../src/converter/types';

class TestElement {
	hidden = false;
	disabled = false;
	textContent = '';
	value = '';
	files: File[] = [];
	dataset = {};
	classList = { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() };
	handlers = new Map<string, () => void>();
	addEventListener(name: string, handler: () => void): void {
		this.handlers.set(name, handler);
	}
	setAttribute = vi.fn();
	append = vi.fn();
	replaceChildren = vi.fn();
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
	postMessage = vi.fn(() => {
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
function chooseFile(name = 'pack.zip'): void {
	element('pack-file').files = [new File([new Uint8Array(64)], name)];
	element('pack-file').handlers.get('change')?.();
}
function completeInspection(worker: TestWorker): void {
	worker.send({
		type: 'detected',
		result: { status: 'supported', version: '1.7', confident: true },
	});
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
		elements.set(match[1], node);
	}
	vi.stubGlobal('document', {
		getElementById: (id: string) => elements.get(id),
		createElement: () => new TestElement(),
		querySelectorAll: () => [],
	});
	vi.stubGlobal('window', { addEventListener: vi.fn() });
	vi.stubGlobal('Worker', TestWorker);
	await import('../src/main');
});

afterEach(() => vi.unstubAllGlobals());

describe('pack inspection recovery', () => {
	it.each(['crash', 'message', 'construction', 'posting'])(
		'offers a retry after an inspection failure through %s',
		(mode) => {
			TestWorker.failConstruction = mode === 'construction';
			TestWorker.failPosting = mode === 'posting';
			chooseFile();
			const initialWorker = TestWorker.instances[0];
			if (mode === 'crash') initialWorker.onerror?.();
			if (mode === 'message') initialWorker.send({ type: 'error', message: 'Read failed' });
			expect(element('convert').textContent).toBe('Retry inspection');
			expect(element('convert').disabled).toBe(false);
			expect(element('error').hidden).toBe(false);
			expect(element('detected-badge').textContent).toBe('Inspection failed');

			TestWorker.failConstruction = false;
			TestWorker.failPosting = false;
			element('convert').click();
			const retryWorker = TestWorker.instances.at(-1)!;
			expect(retryWorker.postMessage).toHaveBeenCalledWith({
				type: 'detect',
				file: element('pack-file').files[0],
			});
			expect(element('error').hidden).toBe(true);
			expect(element('convert').textContent).toBe('Inspecting...');
			completeInspection(retryWorker);
			expect(element('detected-badge').textContent).toBe('Detected: 1.7');
			expect(element('convert').disabled).toBe(false);
			element('convert').click();
			expect(retryWorker.postMessage).toHaveBeenLastCalledWith({
				type: 'convert',
				file: element('pack-file').files[0],
				source: '1.7',
				target: '26.3',
			});
		},
	);

	it('keeps invalid ZIPs blocked and displays their error', () => {
		chooseFile();
		TestWorker.instances[0].send({
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
			chooseFile();
			const oldWorker = TestWorker.instances[0];
			if (action === 'remove') element('remove-file').click();
			else chooseFile(action === 'replace' ? 'new.zip' : 'bad.txt');
			expect(oldWorker.terminate).toHaveBeenCalled();
			const previousText = element('error-text').textContent;
			oldWorker.send({ type: 'error', message: 'Stale error' });
			oldWorker.onerror?.();
			completeInspection(oldWorker);
			expect(element('error-text').textContent).toBe(previousText);
			if (action === 'replace') {
				expect(element('convert').textContent).toBe('Inspecting...');
				completeInspection(TestWorker.instances[1]);
				expect(element('convert').disabled).toBe(false);
			} else {
				expect(element('convert').textContent).toBe('Add a pack first');
				expect(element('file-version-status').hidden).toBe(true);
			}
		},
	);

	it('keeps conversion errors retryable without inspecting the pack again', () => {
		chooseFile();
		completeInspection(TestWorker.instances[0]);
		element('convert').click();
		TestWorker.instances[0].send({ type: 'error', message: 'Conversion failed' });
		expect(element('convert').textContent).toBe('Update pack →');
		expect(element('convert').disabled).toBe(false);
		expect(element('error-text').textContent).toBe('Conversion failed');
	});
});
