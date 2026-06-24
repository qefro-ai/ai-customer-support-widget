import { pipeline, env } from '@huggingface/transformers';

// Disable local models to ensure we fetch from Hugging Face
env.allowLocalModels = false;

class PipelineSingleton {
    static task = 'automatic-speech-recognition' as const;
    static model = 'onnx-community/whisper-tiny';
    static instance: any = null;

    static async getInstance(progress_callback: any) {
        if (this.instance === null) {
            this.instance = await pipeline(this.task, this.model, {
                progress_callback,
                dtype: {
                    encoder_model: 'q4',
                    decoder_model_merged: 'q4'
                }
            });
        }
        return this.instance;
    }
}

self.addEventListener('message', async (event) => {
    const message = event.data;

    if (message.type === 'load') {
        try {
            // Load the model
            await PipelineSingleton.getInstance((x: any) => {
                // Send progress updates back to the main thread
                self.postMessage(x);
            });

            self.postMessage({ status: 'ready' });
        } catch (error) {
            console.error('[Whisper Worker Error]', error);
            self.postMessage({ status: 'error', error: String(error) });
        }
    } else if (message.type === 'transcribe') {
        try {
            // Load the model
            const transcriber = await PipelineSingleton.getInstance((x: any) => {
                // Send progress updates back to the main thread
                self.postMessage(x);
            });

            // message.audio is a Float32Array at 16000Hz
            const output = await transcriber(message.audio, {
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: false,
            });

            self.postMessage({
                status: 'complete',
                text: output.text,
            });
        } catch (error: any) {
            self.postMessage({
                status: 'error',
                error: error.message,
            });
        }
    }
});
