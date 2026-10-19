import './style.css';
import { TARGETS, type TargetVersion } from './converter/versions';
import { PackQueue, type SelectedPack } from './pack-queue';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (!found) throw new Error(`Missing UI element: ${id}`);
	return found as T;
}

const fileInput = element<HTMLInputElement>('pack-file');
const convertButton = element<HTMLButtonElement>('convert');
const dropZone = element<HTMLLabelElement>('drop-zone');
const overrideBtn = element<HTMLButtonElement>('override-btn');
const queue = new PackQueue(refresh);
let target: TargetVersion = '26.3';
let renderedPacks: SelectedPack[] = [];
let lastReports = '';
let wasConverting = false;

function hasIssue(pack: SelectedPack): boolean {
	return ['inspection-failed', 'invalid', 'error'].includes(pack.state);
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
	const result = document.createElement(tag);
	result.className = className;
	result.textContent = text;
	return result;
}

function issueLink(): HTMLAnchorElement {
	const link = node('a', 'issue-link', 'Report a problem on GitHub');
	link.href = 'https://github.com/qzvx/resource-pack-updater/issues';
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	return link;
}

function packStatus(pack: SelectedPack): string {
	switch (pack.state) {
		case 'queued':
			return 'Waiting for inspection';
		case 'inspecting':
			return 'Inspecting pack...';
		case 'inspection-failed':
			return 'Inspection failed';
		case 'invalid':
			return 'Invalid ZIP archive';
		case 'blocked':
			return 'Unsupported pack version';
		case 'converting':
			return `${pack.stage} (${pack.progress}%)`;
		case 'done':
			return `Ready for ${pack.report!.target}`;
		case 'error':
			return 'Conversion failed';
		case 'ready':
			return `${pack.overrode ? 'Using' : pack.confident ? 'Detected' : 'Assumed'}: ${pack.source}`;
	}
}

function canOverride(pack: SelectedPack): boolean {
	return pack.state === 'ready' || pack.state === 'error';
}

function createPackRow(pack: SelectedPack): HTMLLIElement {
	const row = node('li', 'pack-row');
	row.id = `pack-${pack.id}`;
	const heading = node('div', 'pack-row-heading');
	const name = node('strong', 'pack-row-name', pack.file.name);
	name.title = pack.file.name;
	const remove = node('button', 'icon-button', '×');
	remove.type = 'button';
	remove.id = `pack-${pack.id}-remove`;
	remove.setAttribute('aria-label', `Remove ${pack.file.name}`);
	remove.addEventListener('click', () => queue.remove(pack));
	heading.append(name, remove);
	const status = node('span', 'detected-badge');
	status.id = `pack-${pack.id}-status`;
	const size = node('span', 'pack-size', `${(pack.file.size / 1024 / 1024).toFixed(2)} MB`);
	const state = node('div', 'file-version-status');
	state.append(status, size);
	const detail = node('p', 'pack-detail');
	detail.id = `pack-${pack.id}-detail`;
	const actions = node('div', 'pack-actions');
	const override = node('button', 'override-btn');
	override.type = 'button';
	override.id = `pack-${pack.id}-override`;
	override.addEventListener('click', () => queue.override(pack));
	const retry = node('button', 'text-button', 'Retry inspection');
	retry.type = 'button';
	retry.id = `pack-${pack.id}-retry`;
	retry.addEventListener('click', () => queue.retryInspection(pack));
	const download = node('a', 'pack-download', 'Download pack');
	download.id = `pack-${pack.id}-download`;
	download.setAttribute('aria-label', `Download converted ${pack.file.name}`);
	const issue = issueLink();
	issue.id = `pack-${pack.id}-issue`;
	actions.append(override, retry, download, issue);
	row.append(heading, state, detail, actions);
	return row;
}

for (const version of TARGETS) {
	const label = node('label', 'version-option');
	label.dataset.version = version.id;
	const radio = node('input', 'version-radio');
	radio.type = 'radio';
	radio.name = 'target-version';
	radio.value = version.id;
	radio.checked = version.id === target;
	label.append(radio, node('span', 'version-name', version.id));
	if (version.id === '26.3') label.append(node('span', 'version-badge', 'NEWEST'));
	radio.addEventListener('change', () => {
		if (!radio.checked || queue.converting || queue.hasResults) return;
		target = version.id;
		refresh();
	});
	element('versions').append(label);
}

overrideBtn.addEventListener('click', () => {
	if (queue.packs.length === 1) queue.override(queue.packs[0]);
});

function refresh(): void {
	const { packs, converting, hasResults, inspecting } = queue;
	const single = packs.length === 1 ? packs[0] : undefined;
	const locked = converting || hasResults;
	fileInput.disabled = locked;
	element<HTMLButtonElement>('remove-file').disabled = converting;
	element<HTMLButtonElement>('start-again').disabled = converting;
	dropZone.setAttribute('aria-disabled', String(locked));
	dropZone.classList.toggle('disabled-zone', locked);
	dropZone.classList.toggle('has-file', packs.length > 0);
	element('versions').classList.toggle('disabled-picker', locked);
	document.querySelectorAll<HTMLInputElement>('input[name="target-version"]').forEach((radio) => {
		radio.disabled = locked;
		radio.checked = radio.value === target;
		radio.closest('.version-option')?.classList.toggle('selected', radio.checked);
	});
	element('selected-file').hidden = !packs.length;
	element('file-label').textContent = !packs.length
		? 'Drop your resource packs here'
		: single
			? 'Pack selected'
			: `${packs.length} packs selected`;
	element('file-description').innerHTML = packs.length
		? 'Drop ZIPs or <span class="browse-text">browse files</span> to replace selection'
		: 'or <span class="browse-text">browse files</span> to choose ZIPs';
	element('file-name').textContent = single?.file.name ?? `${packs.length} packs selected`;
	element('file-size').textContent =
		`${(packs.reduce((sum, pack) => sum + pack.file.size, 0) / 1024 / 1024).toFixed(2)} MB`;
	element('remove-file').setAttribute(
		'aria-label',
		single ? 'Remove selected file' : 'Clear selected packs',
	);
	element('file-version-status').hidden = !single;
	if (single) {
		element('detected-badge').textContent =
			single.state === 'blocked' ? single.detail! : packStatus(single);
		element('detected-badge').className =
			`detected-badge${single.state === 'blocked' ? ' modern-notice' : ''}`;
		overrideBtn.hidden = !canOverride(single);
		overrideBtn.disabled = converting;
		overrideBtn.textContent = `${single.overrode ? 'switch to' : 'wrong? use'} ${single.source === '1.8' ? '1.7' : '1.8'}`;
	}

	if (renderedPacks.length !== packs.length || renderedPacks.some((pack, i) => pack !== packs[i])) {
		element('pack-list').replaceChildren(...packs.map(createPackRow));
		renderedPacks = [...packs];
	}
	element('pack-list').hidden = packs.length < 2;
	for (const pack of packs) {
		const prefix = `pack-${pack.id}`;
		element(`${prefix}-status`).textContent = packStatus(pack);
		element(`${prefix}-detail`).textContent = pack.detail ?? '';
		element(`${prefix}-detail`).hidden = !pack.detail;
		element<HTMLButtonElement>(`${prefix}-remove`).disabled = converting;
		const override = element<HTMLButtonElement>(`${prefix}-override`);
		override.hidden = !canOverride(pack);
		override.disabled = converting;
		override.textContent = `${pack.overrode ? 'switch to' : 'wrong? use'} ${pack.source === '1.8' ? '1.7' : '1.8'}`;
		const retry = element<HTMLButtonElement>(`${prefix}-retry`);
		retry.hidden = pack.state !== 'inspection-failed';
		retry.disabled = converting;
		const link = element<HTMLAnchorElement>(`${prefix}-download`);
		link.hidden = !pack.url;
		if (pack.url) {
			link.href = pack.url;
			link.download = pack.outputName!;
		}
		element(`${prefix}-issue`).hidden = !hasIssue(pack);
	}

	const ready = queue.readyPacks;
	element('action-area').hidden = converting || (hasResults && !ready.length);
	convertButton.disabled = converting || inspecting || !ready.length;
	if (!packs.length) convertButton.textContent = 'Add a pack first';
	else if (inspecting) convertButton.textContent = 'Inspecting...';
	else if (single?.state === 'inspection-failed') {
		convertButton.textContent = 'Retry inspection';
		convertButton.disabled = false;
	} else if (!ready.length)
		convertButton.textContent =
			single?.state === 'blocked' ? 'Add a 1.7 or 1.8 pack' : 'Choose a valid ZIP';
	else
		convertButton.textContent = single
			? 'Update pack →'
			: `${hasResults ? 'Update remaining' : 'Update'} ${ready.length} ${ready.length === 1 ? 'pack' : 'packs'} →`;

	refreshResults();
	const error = queue.message || (single && hasIssue(single) ? single.detail : '');
	element('error').hidden = !error;
	element('error-text').textContent = error ?? '';
	element('error-issue-link').hidden = !(single && hasIssue(single));
	element('progress-section').hidden = !converting;
	if (converting) {
		const active = queue.activePack;
		const percent = Math.round(
			((queue.batchFinished + (active?.progress ?? 0) / 100) / queue.batchTotal) * 100,
		);
		element<HTMLProgressElement>('progress').value = percent;
		element('progress-percent').textContent = `${percent}%`;
		element('progress-stage').textContent =
			packs.length > 1
				? `Pack ${Math.min(queue.batchFinished + 1, queue.batchTotal)} of ${queue.batchTotal}: ${active?.file.name ?? ''}. ${active?.stage ?? 'Opening your pack'}`
				: (active?.stage ?? 'Opening your pack');
	}
	if (wasConverting && !converting && hasResults) {
		if (single) element('download').focus();
		else element('result-title').focus();
	}
	wasConverting = converting;
}

function refreshResults(): void {
	const done = queue.packs.filter((pack) => pack.state === 'done');
	const key = done.map((pack) => pack.id).join(',');
	element('download-all').hidden = done.length < 2;
	element('result').hidden = !done.length;
	if (!done.length) {
		lastReports = '';
		return;
	}
	const single = queue.packs.length === 1;
	element('result-title').textContent = single
		? 'Your pack is ready.'
		: `${done.length} of ${queue.packs.length} packs ready`;
	element('result-description').textContent = single
		? `${done[0].file.name} updated to ${done[0].report!.target}.`
		: `Download completed packs individually${done.length > 1 ? ' or all at once' : ''}. All packs use Minecraft Java ${done[0].report!.target}.`;
	const download = element<HTMLAnchorElement>('download');
	download.hidden = !single;
	if (single) {
		download.href = done[0].url!;
		download.download = done[0].outputName!;
	}
	element('start-again').textContent = single ? 'Convert another' : 'Choose other packs';
	const reportKey = `${single ? 'single' : 'batch'}:${key}`;
	if (reportKey === lastReports) return;
	lastReports = reportKey;
	const stats = element('result-stats');
	stats.replaceChildren();
	for (const [count, label] of [
		[done.reduce((sum, pack) => sum + pack.report!.outputFiles, 0), 'total files'],
		[
			done.reduce((sum, pack) => sum + pack.report!.updated + pack.report!.renamed, 0),
			'files converted',
		],
		[done.reduce((sum, pack) => sum + pack.report!.archived, 0), 'legacy files preserved'],
	] as const) {
		const item = node('div');
		item.append(node('strong', '', count.toLocaleString()), node('span', '', label));
		stats.append(item);
	}
	const warnings = done.flatMap((pack) =>
		pack.report!.warnings.map((warning) => (single ? warning : `${pack.file.name}: ${warning}`)),
	);
	element('result-notes').hidden = !warnings.length;
	element('notes-summary').textContent =
		`${warnings.length} ${warnings.length === 1 ? 'note' : 'notes'} to review`;
	element('warning-list').replaceChildren(...warnings.map((warning) => node('li', '', warning)));
}

function chooseFiles(files: File[]): void {
	if (queue.converting || queue.hasResults) return;
	queue.replace(files);
}

fileInput.addEventListener('change', () => {
	chooseFiles(Array.from(fileInput.files ?? []));
	fileInput.value = '';
});
let dragDepth = 0;
dropZone.addEventListener('dragenter', (event) => {
	event.preventDefault();
	if (queue.converting || queue.hasResults) return;
	dragDepth++;
	dropZone.classList.add('dragging');
});
dropZone.addEventListener('dragover', (event) => {
	event.preventDefault();
	if (event.dataTransfer)
		event.dataTransfer.dropEffect = queue.converting || queue.hasResults ? 'none' : 'copy';
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
	chooseFiles(Array.from(event.dataTransfer?.files ?? []));
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

function reset(): void {
	queue.clear();
	fileInput.focus();
}
element('remove-file').addEventListener('click', reset);
element('start-again').addEventListener('click', reset);
element('cancel').addEventListener('click', () => queue.cancel());
convertButton.addEventListener('click', () => {
	const single = queue.packs.length === 1 ? queue.packs[0] : undefined;
	if (single?.state === 'inspection-failed') queue.retryInspection(single);
	else queue.convert(target);
});
element('download-all').addEventListener('click', () => {
	const done = queue.packs.filter((pack) => pack.state === 'done');
	if (done.length < 2) return;
	for (const pack of done) element<HTMLAnchorElement>(`pack-${pack.id}-download`).click();
});
window.addEventListener('beforeunload', () => queue.dispose());
refresh();
