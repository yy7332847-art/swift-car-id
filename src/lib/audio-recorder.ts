// Continuous mic capture → periodic self-contained WAV blobs.
// Every `chunkSeconds` we hand off a WAV to the callback, and start a fresh buffer.
// Uses Web Audio API for cross-browser reliability (iOS Safari included).

export interface RecorderOptions {
  chunkSeconds: number;
  targetSampleRate?: number; // default 16000
  overlapSeconds?: number; // default 0.4
  onChunk: (wav: Blob, meta: RecorderChunkMeta) => void;
  onChunkSkipped?: (meta: RecorderChunkMeta & { reason: "silent" }) => void;
  onLevel?: (level: number) => void;
}

export interface RecorderChunkMeta {
  rms: number;
  durationMs: number;
  sampleRate: number;
}

export interface RecorderHandle {
  stop: () => Promise<void>;
}

function isMobileAudioDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  let o = 0, i = 0;
  while (o < outLen) {
    const nextI = Math.floor((o + 1) * ratio);
    let sum = 0, count = 0;
    for (let j = i; j < nextI && j < input.length; j++) { sum += input[j]; count++; }
    out[o] = count > 0 ? sum / count : 0;
    o++; i = nextI;
  }
  return out;
}

export async function startRecorder(opts: RecorderOptions): Promise<RecorderHandle> {
  const targetRate = opts.targetSampleRate ?? 16000;
  const mobile = isMobileAudioDevice();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: { ideal: 1 },
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
      sampleRate: { ideal: 48000 },
    },
  });
  const ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (ac.state === "suspended") await ac.resume().catch(() => undefined);
  // Auto-resume when the tab regains focus (mobile browsers suspend on background).
  const resumeIfNeeded = () => { if (ac.state === "suspended") void ac.resume().catch(() => undefined); };
  const onVisibility = () => { if (typeof document !== "undefined" && document.visibilityState === "visible") resumeIfNeeded(); };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  if (typeof window !== "undefined") window.addEventListener("focus", resumeIfNeeded);
  const source = ac.createMediaStreamSource(stream);
  const highpass = ac.createBiquadFilter();
  highpass.type = "highpass";
  // Mobile: keep low frequencies of guttural letters (ع/ح/خ) — 60Hz cutoff
  // instead of 95Hz preserves the leading sound the recognizer was dropping.
  highpass.frequency.value = mobile ? 60 : 75;
  highpass.Q.value = 0.7;
  // Pre-gain: mobile mics are often held far from the mouth; boost before the
  // compressor so quiet speech reaches a usable level without hard-clipping.
  const preGain = ac.createGain();
  preGain.gain.value = mobile ? 2.2 : 1.4;
  const compressor = ac.createDynamicsCompressor();
  // Softer curve: preserves consonant transients that the old aggressive
  // -48dB / 7:1 setting was flattening into an unrecognizable mush.
  compressor.threshold.value = -32;
  compressor.knee.value = 20;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.22;
  const processor = ac.createScriptProcessor(mobile ? 4096 : 2048, 1, 1);
  const monitor = ac.createGain();
  monitor.gain.value = 0;

  let buffer: Float32Array[] = [];
  let lastFlush = performance.now();
  let bufSamples = 0;
  // Overlap tail — retain the last ~0.4s of samples so a plate cut across chunks is still decoded.
  let overlap: Float32Array | null = null;
  const overlapSeconds = opts.overlapSeconds ?? 0.4;

  processor.onaudioprocess = (e) => {
    const ch = e.inputBuffer.getChannelData(0);
    if (opts.onLevel) {
      let sum = 0;
      for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
      opts.onLevel(Math.sqrt(sum / ch.length));
    }
    buffer.push(new Float32Array(ch));
    bufSamples += ch.length;

    if (performance.now() - lastFlush >= opts.chunkSeconds * 1000) {
      flush();
    }
  };

  function flush() {
    if (bufSamples < ac.sampleRate * 0.25) return;
    const merged = new Float32Array((overlap?.length ?? 0) + bufSamples);
    let o = 0;
    if (overlap) { merged.set(overlap, 0); o = overlap.length; }
    for (const b of buffer) { merged.set(b, o); o += b.length; }
    // Keep tail as overlap for next chunk.
    const tailLen = Math.min(merged.length, Math.floor(ac.sampleRate * overlapSeconds));
    overlap = merged.slice(merged.length - tailLen);
    buffer = []; bufSamples = 0;
    lastFlush = performance.now();
    const ds = downsample(merged, ac.sampleRate, targetRate);
    let sum = 0;
    for (let i = 0; i < ds.length; i++) sum += ds[i] * ds[i];
    const rms = Math.sqrt(sum / ds.length);
    const meta = { rms, durationMs: (ds.length / targetRate) * 1000, sampleRate: targetRate };
    const minRms = mobile ? 0.00010 : 0.00035;
    if (rms < minRms) {
      opts.onChunkSkipped?.({ ...meta, reason: "silent" });
      return;
    }
    const wav = encodeWav(ds, targetRate);
    opts.onChunk(wav, meta);
  }

  source.connect(highpass);
  highpass.connect(preGain);
  preGain.connect(compressor);
  compressor.connect(processor);
  processor.connect(monitor);
  monitor.connect(ac.destination);

  return {
    stop: async () => {
      flush();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      if (typeof window !== "undefined") window.removeEventListener("focus", resumeIfNeeded);
      processor.disconnect();
      monitor.disconnect();
      compressor.disconnect();
      preGain.disconnect();
      highpass.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await ac.close();
    },
  };
}

