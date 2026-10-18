/// <reference lib="webworker" />
import { convert } from './convert';
import { detectVersion } from './detect';
import type { WorkerRequest, WorkerResponse } from './types';

const worker = self as DedicatedWorkerGlobalScope;
function send(message: WorkerResponse, transfer: Transferable[] = []): void {
	worker.postMessage(message, transfer);
}
worker.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	try {
		const req = event.data;
		if (req.type === 'detect') {
			const data = new Uint8Array(await req.file.arrayBuffer());
			const result = detectVersion(data, req.file.name);
			send({ type: 'detected', result });
			return;
		}
		const { file, source, target } = req;
		const data = new Uint8Array(await file.arrayBuffer());
		const result = convert(data, source, target, (progress) =>
			send({ type: 'progress', progress }),
		);
		send({ type: 'done', ...result }, [result.zip.buffer]);
	} catch (error) {
		send({
			type: 'error',
			message:
				error instanceof Error ? error.message : 'Conversion failed. Try another resource pack.',
		});
	}
};
