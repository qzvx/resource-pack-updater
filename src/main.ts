import './style.css';
import { TARGETS, type SourceVersion, type TargetVersion } from './converter/versions';
import { LIMITS } from './converter/pack';
import { detectVersion, type DetectionResult } from './converter/detect';
import type { ConversionReport, WorkerResponse } from './converter/types';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (!found) throw new Error(`Missing UI element: ${id}`);
	return found as T;
}

const fileInput = element<HTMLInputElement>('pack-file');
const convertButton = element<HTMLButtonElement>('convert');
const dropZone = element<HTMLLabelElement>('drop-zone');
const versionsContainer = element('versions');
const statusContainer = element('file-version-status');
const detectedBadge = element('detected-badge');
const overrideBtn = element<HTMLButtonElement>('override-btn');

let file: File | undefined;
let source: SourceVersion = '1.8';
let target: TargetVersion = '26.3';
let worker: Worker | undefined;
let urls: string[] = [];
let converting = false;
let isConfident = false;
let userOverrode = false;
let detectionResult: DetectionResult | undefined;

for (const version of TARGETS) {
	const label = document.createElement('label');
	label.className = 'version-option';
	label.dataset.version = version.id;

	const radio = document.createElement('input');
	radio.type = 'radio';
	radio.name = 'target-version';
	radio.value = version.id;
	radio.checked = version.id === target;
	radio.className = 'version-radio';

	const name = document.createElement('span');
	name.className = 'version-name';
	name.textContent = version.id;

	label.append(radio, name);

	if (version.id === '26.3') {
		const badge = document.createElement('span');
		badge.className = 'version-badge';
		badge.textContent = 'NEWEST';
		label.append(badge);
	}

	radio.addEventListener('change', () => {
		if (radio.checked) {
			if (converting) return;
			target = version.id;
			clearResult();
			refresh();
		}
	});

	versionsContainer.append(label);
}

overrideBtn.addEventListener('click', () => {
	if (converting || !file) return;
	userOverrode = true;
	source = source === '1.8' ? '1.7' : '1.8';
	clearResult();
	refresh();
});

function refresh(): void {
	const isDone = !element('result').hidden;
	element('action-area').hidden = isDone || converting;
	// convertButton disabled state and text are set in the file branches below
	fileInput.disabled = converting || isDone;
	element<HTMLButtonElement>('remove-file').disabled = converting || isDone;
	overrideBtn.disabled = converting || isDone;
	dropZone.setAttribute('aria-disabled', String(converting || isDone));
	dropZone.classList.toggle('disabled-zone', isDone);
	element('versions').classList.toggle('disabled-picker', isDone);

	document.querySelectorAll<HTMLInputElement>('input[name="target-version"]').forEach((radio) => {
		radio.disabled = converting || isDone;
		radio.checked = radio.value === target;
		const opt = radio.closest('.version-option');
		if (opt) {
			opt.classList.toggle('selected', radio.value === target);
		}
	});
	if (!file) {
		statusContainer.hidden = true;
		convertButton.textContent = 'Add a pack first';
		convertButton.disabled = true;
	} else if (detectionResult?.status === 'modern') {
		statusContainer.hidden = false;
		detectedBadge.textContent = detectionResult.detail;
		detectedBadge.className = 'detected-badge modern-notice';
		overrideBtn.hidden = true;
		convertButton.textContent = 'Add a 1.7 or 1.8 pack';
		convertButton.disabled = true;
	} else {
		statusContainer.hidden = false;
		detectedBadge.className = 'detected-badge';
		if (!userOverrode) {
			detectedBadge.textContent = isConfident ? `Detected: ${source}` : `Assumed: ${source}`;
		} else {
			detectedBadge.textContent = `Using: ${source}`;
		}
		const other = source === '1.8' ? '1.7' : '1.8';
		overrideBtn.hidden = false;
		overrideBtn.textContent = userOverrode ? `switch to ${other}` : `wrong? use ${other}`;
		convertButton.textContent = 'Update pack →';
		convertButton.disabled = converting || isDone;
	}
	element('selected-file').hidden = !file;
	dropZone.classList.toggle('has-file', !!file);
	element('file-label').textContent = file ? 'Pack selected' : 'Drop your resource pack here';
	element('file-description').innerHTML = file
		? 'Drop another ZIP or <span class="browse-text">browse files</span>'
		: 'or <span class="browse-text">browse files</span> to choose a ZIP';
	element('file-name').textContent = file?.name ?? '';
	element('file-size').textContent = file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : '';
	dropZone.setAttribute('aria-disabled', String(converting));
}

function clearResult(): void {
	urls.forEach((url) => URL.revokeObjectURL(url));
	urls = [];
	element('result').hidden = true;
	element('error').hidden = true;
	element('progress-section').hidden = true;
	element('progress-stage').textContent = 'Opening your pack';
	element('progress-percent').textContent = '0%';
	element<HTMLProgressElement>('progress').value = 0;
}

function showError(message: string): void {
	element('error').textContent = message;
	element('error').hidden = false;
}

async function chooseFile(next: File | undefined): Promise<void> {
	if (converting || !next) return;
	clearResult();
	if (!/\.zip$/i.test(next.name)) {
		file = undefined;
		detectionResult = undefined;
		userOverrode = false;
		refresh();
		showError("That file isn't a ZIP. Choose a .zip Minecraft resource pack.");
		return;
	}
	if (next.size > LIMITS.zip) {
		file = undefined;
		detectionResult = undefined;
		userOverrode = false;
		refresh();
		showError('This ZIP is too large (over 256 MB). Pick a pack under 256 MB.');
		return;
	}
	if (next.size < 22) {
		file = undefined;
		detectionResult = undefined;
		userOverrode = false;
		refresh();
		showError('This ZIP file is empty or incomplete. Choose a valid pack.');
		return;
	}
	file = next;
	userOverrode = false;

	try {
		const buffer = await file.arrayBuffer();
		detectionResult = detectVersion(new Uint8Array(buffer), file.name);
		if (detectionResult.status === 'supported') {
			source = detectionResult.version;
			isConfident = detectionResult.confident;
		}
	} catch {
		detectionResult = { status: 'supported', version: '1.8', confident: false };
		source = '1.8';
		isConfident = false;
	}
	refresh();
}

fileInput.addEventListener('change', () => {
	void chooseFile(fileInput.files?.[0]);
	fileInput.value = '';
});

let dragDepth = 0;
dropZone.addEventListener('dragenter', (event) => {
	event.preventDefault();
	if (!converting) {
		dragDepth++;
		dropZone.classList.add('dragging');
	}
});
dropZone.addEventListener('dragover', (event) => {
	event.preventDefault();
	if (event.dataTransfer) event.dataTransfer.dropEffect = converting ? 'none' : 'copy';
});
dropZone.addEventListener('dragleave', (event) => {
	event.preventDefault();
	if (--dragDepth <= 0) {
		dragDepth = 0;
		dropZone.classList.remove('dragging');
	}
});
dropZone.addEventListener('drop', (event) => {
	event.preventDefault();
	dragDepth = 0;
	dropZone.classList.remove('dragging');
	if ((event.dataTransfer?.files.length ?? 0) > 1) {
		showError('Drop one resource pack at a time.');
		return;
	}
	void chooseFile(event.dataTransfer?.files[0]);
});

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

element('remove-file').addEventListener('click', () => {
	file = undefined;
	detectionResult = undefined;
	userOverrode = false;
	isConfident = false;
	source = '1.8';
	clearResult();
	refresh();
	fileInput.focus();
});

element('start-again').addEventListener('click', () => {
	file = undefined;
	detectionResult = undefined;
	userOverrode = false;
	isConfident = false;
	source = '1.8';
	clearResult();
	refresh();
	fileInput.focus();
});

function stop(): void {
	worker?.terminate();
	worker = undefined;
	converting = false;
	refresh();
}

element('cancel').addEventListener('click', () => {
	stop();
	clearResult();
	showError('Conversion cancelled.');
});

convertButton.addEventListener('click', () => {
	if (!file || converting) return;
	clearResult();
	converting = true;
	refresh();
	element('progress-section').hidden = false;
	try {
		worker = new Worker(new URL('./converter/worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
			const message = event.data;
			if (message.type === 'progress') {
				element<HTMLProgressElement>('progress').value = message.progress.percent;
				element('progress-percent').textContent = `${message.progress.percent}%`;
				element('progress-stage').textContent = message.progress.stage;
			} else if (message.type === 'error') {
				stop();
				element('progress-section').hidden = true;
				showError(message.message);
			} else {
				stop();
				element('progress-section').hidden = true;
				showResult(message.zip, message.report);
			}
		};
		worker.onerror = () => {
			stop();
			element('progress-section').hidden = true;
			showError("Couldn't read this ZIP. Make sure it's an uncorrupted Java resource pack.");
		};
		worker.postMessage({ file, source, target });
	} catch {
		stop();
		element('progress-section').hidden = true;
		showError('Could not start the worker. Open this in a current browser.');
	}
});

function showResult(zip: Uint8Array<ArrayBuffer>, report: ConversionReport): void {
	const blob = new Blob([zip], { type: 'application/zip' });
	const url = URL.createObjectURL(blob);
	urls.push(url);
	const downloadLink = element<HTMLAnchorElement>('download');
	downloadLink.href = url;
	const originalName = file?.name.replace(/\.zip$/i, '') ?? 'pack';
	downloadLink.download = `${originalName}-${target}.zip`;

	element('result-description').textContent =
		`${file?.name} updated to ${target} (${(report.updated + report.renamed).toLocaleString()} assets converted).`;
	const stats = element('result-stats');
	stats.replaceChildren();
	for (const [count, label] of [
		[report.outputFiles, 'total files'],
		[report.updated + report.renamed, 'files converted'],
		[report.archived, 'legacy files preserved'],
	]) {
		const item = document.createElement('div');
		const strong = document.createElement('strong');
		strong.textContent = Number(count).toLocaleString();
		const span = document.createElement('span');
		span.textContent = String(label);
		item.append(strong, span);
		stats.append(item);
	}
	element('result-notes').hidden = report.warnings.length === 0;
	element('notes-summary').textContent =
		`${report.warnings.length} ${report.warnings.length === 1 ? 'note' : 'notes'} to review`;
	const list = element('warning-list');
	list.replaceChildren();
	for (const warning of report.warnings) {
		const item = document.createElement('li');
		item.textContent = warning;
		list.append(item);
	}
	element('result').hidden = false;
	refresh();
	downloadLink.focus();
}

window.addEventListener('beforeunload', () => {
	worker?.terminate();
	urls.forEach((url) => URL.revokeObjectURL(url));
});

refresh();
