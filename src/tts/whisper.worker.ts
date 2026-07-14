let pipeline: any;
let env: any;

class PipelineSingleton {
    static task = 'automatic-speech-recognition' as const;
    static model = 'onnx-community/whisper-tiny';
    static instance: any = null;

    static async getInstance(progressCallback: (progress: any) => void) {
        if (!pipeline) {
            const transformers = await import(
                // @ts-expect-error The runtime CDN import keeps ONNX/Wasm out of the widget bundle.
                'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0'
            );
            pipeline = transformers.pipeline;
            env = transformers.env;
            env.allowLocalModels = false;
        }

        if (this.instance === null) {
            this.instance = await pipeline(this.task, this.model, {
                progress_callback: progressCallback,
                dtype: {
                    encoder_model: 'q4',
                    decoder_model_merged: 'q4',
                },
            });
        }
        return this.instance;
    }
}

function reportProgress(progress: any): void {
    if (progress?.status === 'progress' && typeof progress.progress === 'number') {
        self.postMessage({ status: 'progress', progress: progress.progress });
    }
}

self.addEventListener('message', async (event: MessageEvent) => {
    const message = event.data;

    if (message.type === 'load') {
        try {
            await PipelineSingleton.getInstance(reportProgress);
            self.postMessage({ status: 'ready' });
        } catch (error) {
            console.error('[Whisper Transformers.js Worker]', error);
            self.postMessage({ status: 'error', error: String(error) });
        }
    } else if (message.type === 'transcribe') {
        try {
            const transcriber = await PipelineSingleton.getInstance(reportProgress);
            const language = message.language
                ?.toLowerCase()
                .split(/[-_]/, 1)[0];
            const output = await transcriber(message.audio, {
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: false,
                task: 'transcribe',
                ...(language && language !== 'auto' ? { language } : {}),
            });

            self.postMessage({
                status: 'complete',
                text: output.text,
            });
        } catch (error: any) {
            self.postMessage({
                status: 'error',
                error: error?.message || String(error),
            });
        }
    }
});
