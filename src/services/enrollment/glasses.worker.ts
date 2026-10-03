import { pipeline, RawImage, env, type ZeroShotImageClassificationPipeline } from '@huggingface/transformers';
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
let classifier: Promise<ZeroShotImageClassificationPipeline> | undefined;
self.onmessage = async (event: MessageEvent<{ image: string }>) => {
  try {
    classifier ||= (pipeline as any)('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', { dtype: 'q8' });
    const model = await classifier;
    const labels = ['a face wearing eyeglasses', 'a face without eyeglasses'];
    const result: any = await (model as any)(await RawImage.read(event.data.image), labels);
    const best: any = (Array.isArray(result[0]) ? result[0] : result)[0];
    // This is a model score, not a calibrated probability. Low scores require confirmation.
    self.postMessage({ glasses: best?.score >= 0.8 ? best?.label === labels[0] : null, score: best?.score || 0 });
  } catch { self.postMessage({ glasses: null, score: 0 }); }
};
