/* public/js/recorder.js
 * MediaRecorder wrapper.
 * Manages mic stream → GainNode → MediaStreamDestination → MediaRecorder.
 * Recorder.init() is idempotent: safe to call before each take.
 */
'use strict';

const Recorder = (() => {
  let _micStream       = null;
  let _micSource       = null;
  let _micGainNode     = null;
  let _recDest         = null;
  let _mediaRecorder   = null;
  let _analyserNode    = null;
  let _chunks          = [];
  let _currentBlob     = null;
  let _initialized     = false;

  /**
   * Request microphone & wire up the audio graph.
   * Returns the GainNode so the caller can schedule automation.
   * Idempotent: reuses existing mic stream if still active.
   */
  async function init(audioCtx) {
    if (_initialized && _micStream?.active) {
      return _micGainNode;
    }

    _micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    _micSource = audioCtx.createMediaStreamSource(_micStream);

    _micGainNode = audioCtx.createGain();
    _micGainNode.gain.value = 1.0; 

    _micSource.connect(_micGainNode);

    _analyserNode = audioCtx.createAnalyser();
    _analyserNode.fftSize = 512;
    _micGainNode.connect(_analyserNode);

    _recDest = audioCtx.createMediaStreamDestination();
    _micGainNode.connect(_recDest);

    _initialized = true;
    console.log('[Recorder] Mic initialized');
    return _micGainNode;
  }

  function getAnalyserNode() { return _analyserNode; }

  function start() {
    if (!_recDest) throw new Error('Recorder not initialised — call init() first');

    _chunks = [];
    _currentBlob = null;

    const mimeType = _bestMimeType();
    _mediaRecorder = new MediaRecorder(_recDest.stream, mimeType ? { mimeType } : {});
    _mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) _chunks.push(e.data); };
    _mediaRecorder.start(100); // collect every 100 ms
    console.log('[Recorder] Recording started with mimeType:', _mediaRecorder.mimeType);
  }

  function stop() {
    return new Promise((resolve, reject) => {
      if (!_mediaRecorder || _mediaRecorder.state === 'inactive') {
        resolve(_currentBlob);
        return;
      }
      _mediaRecorder.onstop = () => {
        _currentBlob = new Blob(_chunks, { type: _mediaRecorder.mimeType || 'audio/webm' });
        console.log('[Recorder] Stopped. Blob size:', _currentBlob.size);
        resolve(_currentBlob);
      };
      _mediaRecorder.onerror = e => reject(e.error);
      _mediaRecorder.stop();
    });
  }

  function _bestMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }

  function getMicGainNode()      { return _micGainNode; }
  function getLatestBlob()       { return _currentBlob; }

  async function getBlobAsArrayBuffer() {
    if (!_currentBlob) return null;
    return _currentBlob.arrayBuffer();
  }

  /** Full teardown (call on logout / page unload). */
  function release() {
    try { _mediaRecorder?.stop(); } catch { /* ok */ }
    _micStream?.getTracks().forEach(t => t.stop());
    _micStream    = null;
    _micSource    = null;
    _micGainNode  = null;
    _recDest      = null;
    _mediaRecorder= null;
    _chunks       = [];
    _currentBlob  = null;
    _initialized  = false;
    console.log('[Recorder] Released');
  }

  return { init, start, stop, getMicGainNode, getLatestBlob, getBlobAsArrayBuffer, release, getAnalyserNode };
})();
