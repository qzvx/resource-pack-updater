/// <reference lib="webworker" />
import { convert } from './convert';
import type { ConvertRequest, WorkerResponse } from './types';

const worker = self as DedicatedWorkerGlobalScope;
function send(message: WorkerResponse, transfer: Transferable[] = []): void {
	worker.postMessage(message, transfer);
}
worker.onmessage = async (event: MessageEvent<ConvertRequest>) => {
	try {
		const { file, source, target } = event.data;
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
