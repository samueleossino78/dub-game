/* public/js/audioEngine.js
 * Core audio engine.
 * One AudioContext, one GainNode per track â€” no surprises.
 *
 * Tracks managed:
 *  - soundtrack         (always at 1.0 unless muted for recording of a clip with no tracks)
 *  - voce_<charId>      original voice per character (AudioBuffer loaded from server)
 *  - dubbed_<charId>    recorded voice (AudioBuffer decoded from blob) â€” playback only
 *
 * All AudioBufferSourceNodes are started at the same scheduled time,
 * keeping everything sample-accurate.
 */
'use strict';

const AudioEngine = (() => {
  let ctx = null;
  /** @type {Object.<string,AudioBuffer>} */
  let audioBuffers = {};
  /** @type {ClipMeta|null} */
  let clipMeta = null;
  /** Active nodes list for cleanup */
  let activeNodes = []; // { source: AudioBufferSourceNode, gain: GainNode }
  /** Interval IDs */
  let _micIndicatorInterval = null;

  // â”€â”€ Context â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function ensureContext() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // â”€â”€ Load Clip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * Fetch and decode all audio assets for a clip.
   * Safe to call multiple times; will reload if meta changes.
   */
  async function loadClip(meta) {
    ensureContext();
    clipMeta = meta;
    audioBuffers = {};

    const toLoad = [];

    // Soundtrack
    if (meta.soundtrack) {
      toLoad.push({ key: 'soundtrack', url: meta.soundtrack });
    }

    // Per-character voices
    if (meta.personaggi) {
      meta.personaggi.forEach(p => {
        if (p.voceOriginale) {
          toLoad.push({ key: `voce_${p.id}`, url: p.voceOriginale });
        }
        if (p.vociSeparate) {
          p.vociSeparate.forEach((v, idx) => {
            toLoad.push({ key: `voce_${p.id}_${idx}`, url: v.url });
          });
        }
      });
    } else if (meta.voceOriginale) {
      // Fallback: single original track
      toLoad.push({ key: 'voce_originale', url: meta.voceOriginale });
    }

    const results = await Promise.allSettled(
      toLoad.map(({ key, url }) => _fetchAndDecode(key, url))
    );

    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.warn(`[AudioEngine] Failed to load ${toLoad[i].key}:`, r.reason?.message);
      }
    });

    console.log('[AudioEngine] Loaded buffers:', Object.keys(audioBuffers));
    return audioBuffers;
  }

  async function _fetchAndDecode(key, url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const ab  = await res.arrayBuffer();
    audioBuffers[key] = await ctx.decodeAudioData(ab);
  }

  // â”€â”€ Node Factory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * Create a BufferSource â†’ GainNode â†’ destination chain.
   * Registers in activeNodes for cleanup.
   * Returns { source, gain } or null if buffer is missing.
   */
  function _createNode(buffer, gainValue) {
    if (!buffer) return null;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    source.connect(gain);
    gain.connect(ctx.destination);
    activeNodes.push({ source, gain });
    return { source, gain };
  }

  // â”€â”€ Stop All â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function stopAll() {
    if (_micIndicatorInterval) { clearInterval(_micIndicatorInterval); _micIndicatorInterval = null; }
    activeNodes.forEach(({ source }) => { try { source.stop(); } catch { /* already stopped */ } });
    activeNodes = [];
  }

  // â”€â”€ Recording Reference Playback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * Start reference audio for the recording phase.
   * - Soundtrack:                              gain 1.0
   * - Own character original voice:            gain 0.15 (ducked)
   * - Other characters original voices:        gain 1.0
   * - Fallback (no per-char tracks):           single original at 0.15
   *
   * @param {string|null} myCharId  Own character id, or null if spectator.
   * @returns {number} AudioContext start time (ctx.currentTime offset by tiny buffer)
   */
  function startRecordingRef(myCharId) {
    ensureContext();
    stopAll();

    const startAt = ctx.currentTime + 0.12;

    // Soundtrack â€” always full
    const st = _createNode(audioBuffers['soundtrack'], 1.0);
    if (st) st.source.start(startAt);

    if (clipMeta.personaggi && clipMeta.personaggi.length > 0) {
      for (const char of clipMeta.personaggi) {
        const g = (char.id === myCharId) ? 0.15 : 1.0;
        if (char.voceOriginale) {
          const buf = audioBuffers[`voce_${char.id}`];
          const node = _createNode(buf, g);
          if (node) node.source.start(startAt);
        }
        if (char.vociSeparate) {
          char.vociSeparate.forEach((v, idx) => {
            const buf = audioBuffers[`voce_${char.id}_${idx}`];
            const node = _createNode(buf, g);
            if (node) node.source.start(startAt + v.start);
          });
        }
      }
    } else {
      // Fallback: single original, ducked only if player is actually dubbing
      const g = myCharId ? 0.15 : 1.0;
      const node = _createNode(audioBuffers['voce_originale'], g);
      if (node) node.source.start(startAt);
    }

    return startAt;
  }

  function startSegmentRef(myCharId, offsetTime, duckMyChar = false) {
    ensureContext();
    stopAll();

    const startAt = ctx.currentTime + 0.05;

    // Soundtrack
    const st = _createNode(audioBuffers['soundtrack'], 1.0);
    if (st) st.source.start(startAt, offsetTime);

    if (clipMeta.personaggi && clipMeta.personaggi.length > 0) {
      for (const char of clipMeta.personaggi) {
        const g = (char.id === myCharId && duckMyChar) ? 0.0 : 1.0;
        
        const playOrig = (buf, bufStart = 0) => {
          if (!buf) return;
          const node = _createNode(buf, g);
          if (!node) return;
          const playTime = Math.max(0, bufStart - offsetTime);
          const bufOffset = Math.max(0, offsetTime - bufStart);
          node.source.start(startAt + playTime, bufOffset);
        };

        if (char.voceOriginale) playOrig(audioBuffers[`voce_${char.id}`], 0);
        if (char.vociSeparate) {
          char.vociSeparate.forEach((v, idx) => {
            playOrig(audioBuffers[`voce_${char.id}_${idx}`], v.start);
          });
        }
      }
    } else {
      const g = (myCharId && duckMyChar) ? 0.0 : 1.0;
      const node = _createNode(audioBuffers['voce_originale'], g);
      if (node) node.source.start(startAt, offsetTime);
    }
    return startAt;
  }

  // â”€â”€ Mic Gain Automation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * Schedule mic gain to 1 during character's speaking intervals.
   * Uses AudioContext time for sample-accurate automation.
   *
   * @param {GainNode}       micGainNode
   * @param {number[][]}     battute       [[tStart,tEnd], ...]
   * @param {number}         clipStartTime ctx.currentTime when clip started
   */
  function scheduleMicGain(micGainNode, battute, clipStartTime) {
    if (!micGainNode) return;
    micGainNode.gain.cancelScheduledValues(clipStartTime);
    micGainNode.gain.setValueAtTime(0, clipStartTime);
    for (const [tStart, tEnd] of (battute || [])) {
      micGainNode.gain.setValueAtTime(1, clipStartTime + tStart);
      micGainNode.gain.setValueAtTime(0, clipStartTime + tEnd);
    }
  }

  /**
   * Poll mic activity to drive a UI indicator.
   * @param {number[][]} battute
   * @param {number}     clipStartTime
   * @param {Function}   onActive  called with (boolean)
   */
  function trackMicActivity(battute, clipStartTime, onActive) {
    if (_micIndicatorInterval) clearInterval(_micIndicatorInterval);
    _micIndicatorInterval = setInterval(() => {
      const elapsed = ctx.currentTime - clipStartTime;
      const active  = (battute || []).some(([s, e]) => elapsed >= s && elapsed < e);
      onActive(active);
    }, 50);
  }

  // â”€â”€ Replay (listen back to own take) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * Play reference audio + decoded recorded blob together.
   * Own character's original voice is ducked; dubbed take plays at full.
   */
  async function startReplay(myCharId, recordedBlob) {
    ensureContext();
    stopAll();

    let recordedBuffer = null;
    if (recordedBlob) {
      try {
        const ab = await recordedBlob.arrayBuffer();
        recordedBuffer = await ctx.decodeAudioData(ab);
      } catch (e) {
        console.warn('[AudioEngine] Could not decode recorded blob:', e.message);
      }
    }

    const startAt = ctx.currentTime + 0.12;

    // Soundtrack
    const st = _createNode(audioBuffers['soundtrack'], 1.0);
    if (st) st.source.start(startAt);

    if (clipMeta.personaggi && clipMeta.personaggi.length > 0) {
      for (const char of clipMeta.personaggi) {
        const g = (char.id === myCharId) ? 0.15 : 1.0;
        if (char.voceOriginale) {
          const buf = audioBuffers[`voce_${char.id}`];
          const node = _createNode(buf, g);
          if (node) node.source.start(startAt);
        }
        if (char.vociSeparate) {
          char.vociSeparate.forEach((v, idx) => {
            const buf = audioBuffers[`voce_${char.id}_${idx}`];
            const node = _createNode(buf, g);
            if (node) node.source.start(startAt + v.start);
          });
        }
      }
    } else {
      const node = _createNode(audioBuffers['voce_originale'], myCharId ? 0.15 : 1.0);
      if (node) node.source.start(startAt);
    }

    // Dubbed take
    if (recordedBuffer) {
      const node = _createNode(recordedBuffer, 1.0);
      if (node) node.source.start(startAt);
    }

    return startAt;
  }

  // â”€â”€ Final Playback (La Prima Visione) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * Build and start the final mix.
   * - Dubbed chars: original at 0.20 + dubbed take at 1.0
   * - Non-dubbed:   original at 1.0
   * - Soundtrack:   1.0
   *
   * @param {Object.<string,ArrayBuffer>} dubbedABs  charId â†’ ArrayBuffer
   * @param {string[]}                    assignedCharIds
   * @returns {Promise<{ startAt: number, duration: number }>}
   */
  async function startFinalPlayback(dubbedABs, assignedCharIds) {
    ensureContext();
    stopAll();

    // Decode all dubbed blobs
    const dubbedBuffers = {};
    await Promise.allSettled(
      Object.entries(dubbedABs).map(async ([charId, data]) => {
        try {
          const ab = _toArrayBuffer(data);
          dubbedBuffers[charId] = await ctx.decodeAudioData(ab);
        } catch (e) {
          console.warn(`[AudioEngine] Could not decode dubbed blob for ${charId}:`, e.message);
        }
      })
    );

    const startAt = ctx.currentTime + 0.12;

    // Soundtrack
    const st = _createNode(audioBuffers['soundtrack'], 1.0);
    if (st) st.source.start(startAt);

    if (clipMeta.personaggi && clipMeta.personaggi.length > 0) {
      for (const char of clipMeta.personaggi) {
        const isDubbed = assignedCharIds.includes(char.id);

        const playOrig = (buf, startOffset = 0) => {
          if (!buf) return;
          // Abbassato per far risaltare la musica (da 1.0 a 0.65 e da 0.20 a 0.05)
          const node = _createNode(buf, isDubbed ? 0.05 : 0.65);
          if (node) node.source.start(startAt + startOffset);
        };

        if (char.voceOriginale) {
          playOrig(audioBuffers[`voce_${char.id}`], 0);
        }
        if (char.vociSeparate) {
          char.vociSeparate.forEach((v, idx) => {
            playOrig(audioBuffers[`voce_${char.id}_${idx}`], v.start);
          });
        }

        if (isDubbed) {
          // Dubbed take: full
          const dubNode = _createNode(dubbedBuffers[char.id], 1.0);
          if (dubNode) dubNode.source.start(startAt);
        }
      }
    } else {
      // Fallback single track
      const hasDub     = assignedCharIds.length > 0;
      const origNode   = _createNode(audioBuffers['voce_originale'], hasDub ? 0.05 : 0.65);
      if (origNode) origNode.source.start(startAt);

      if (hasDub) {
        const firstBuf = Object.values(dubbedBuffers)[0];
        const dubNode  = _createNode(firstBuf, 1.0);
        if (dubNode) dubNode.source.start(startAt);
      }
    }

    return { startAt, duration: clipMeta.durata };
  }

  // â”€â”€ Utility â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // --- Waveform & Segment Tools ---
  async function renderOriginalVoiceSegment(charId, startTime, endTime) {
    const duration = endTime - startTime;
    if (duration <= 0) return null;
    const sr = ctx ? ctx.sampleRate : 44100;
    const offCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, sr * duration, sr);
    
    const char = clipMeta.personaggi?.find(p => p.id === charId);
    if (!char) return null;

    const playNode = (buf, startOffset = 0) => {
      if (!buf) return;
      const src = offCtx.createBufferSource();
      src.buffer = buf;
      src.connect(offCtx.destination);
      const playAt = Math.max(0, startOffset - startTime);
      const offsetInBuf = Math.max(0, startTime - startOffset);
      src.start(playAt, offsetInBuf);
    };

    if (char.voceOriginale) playNode(audioBuffers[`voce_${charId}`], 0);
    if (char.vociSeparate) {
      char.vociSeparate.forEach((v, idx) => {
        playNode(audioBuffers[`voce_${charId}_${idx}`], v.start);
      });
    }
    return await offCtx.startRendering();
  }

  async function mixSegmentsToWav(segments, totalDuration) {
    const sr = ctx ? ctx.sampleRate : 44100;
    const offCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, sr * totalDuration, sr);

    for (const seg of segments) {
      if (!seg.blob) continue;
      try {
        const ab = await seg.blob.arrayBuffer();
        const buf = await offCtx.decodeAudioData(ab);
        const src = offCtx.createBufferSource();
        src.buffer = buf;
        src.connect(offCtx.destination);
        src.start(seg.start);
      } catch (e) {
        console.warn('Failed to decode segment', e);
      }
    }
    const rendered = await offCtx.startRendering();
    return _audioBufferToWav(rendered);
  }

  function _audioBufferToWav(buffer) {
    const numChannels = 1;
    const sampleRate = buffer.sampleRate;
    const result = new Float32Array(buffer.length);
    buffer.copyFromChannel(result, 0);

    const blockAlign = 2;
    const dataSize = result.length * 2;
    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);

    const writeString = (o, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(o + i, str.charCodeAt(i));
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < result.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, result[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return arrayBuffer;
  }

  function _toArrayBuffer(data) {
    if (data instanceof ArrayBuffer)    return data;
    if (data instanceof Uint8Array)     return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    if (Array.isArray(data))            return new Uint8Array(data).buffer;
    // Socket.io may also pass a plain object with numeric keys
    if (data && typeof data === 'object') {
      const arr = new Uint8Array(Object.keys(data).length);
      for (const [k, v] of Object.entries(data)) arr[+k] = v;
      return arr.buffer;
    }
    return data;
  }

  function getContext()  { return ctx; }
  function getClipMeta() { return clipMeta; }

  return {
    ensureContext,
    loadClip,
    startRecordingRef,
    scheduleMicGain,
    trackMicActivity,
    startReplay,
    startFinalPlayback,
    stopAll,
    getContext,
    getClipMeta,
    renderOriginalVoiceSegment,
    mixSegmentsToWav,
    startSegmentRef,
  };
})();

