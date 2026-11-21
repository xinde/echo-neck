const root = new URL('./vendor/mediapipe/', import.meta.url);
let pending;

export function loadTracker() {
  return (pending ??= (async () => {
    const { FilesetResolver, FaceLandmarker } = await import(new URL('vision_bundle.mjs', root));
    const files = await FilesetResolver.forVisionTasks(new URL('wasm', root).href);
    const options = {
      baseOptions: { modelAssetPath: new URL('face_landmarker.task', root).href, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
    };
    try {
      return await FaceLandmarker.createFromOptions(files, options);
    } catch {
      options.baseOptions.delegate = 'CPU';
      return FaceLandmarker.createFromOptions(files, options);
    }
  })().catch((e) => {
    pending = null;
    throw e;
  }));
}
