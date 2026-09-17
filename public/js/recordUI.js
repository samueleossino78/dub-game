'use strict';

const RecordUI = (() => {
  let _state = null;
  let _myCharId = null;
  let _clipDuration = 0;
  
  let _segments = []; // array of { start, end, blob, originalPcm }
  let _activeSegmentIndex = -1;
  let _mode = null; // 'listen' | 'record'
  
  let _animationFrame = null;
  let _timerInt = null;

  function beginSession(state, myCharId) {
    _state = state;
    _myCharId = myCharId;
    _clipDuration = state.clipMeta?.durata || 10;
    
    _segments = [];
    _activeSegmentIndex = -1;
    _mode = null;
    
    const charBox = document.getElementById('recording-char-info');
    const submitBtn = document.getElementById('btn-submit-takes');
    
    _setupClipDisplay(state.clipMeta);
    submitBtn.hidden = true;
    submitBtn.disabled = false;
    submitBtn.onclick = _submitTakes;

    if (!myCharId) {
      charBox.innerHTML = '\uD83C\uDFAC <strong>Spettatore</strong> \u2014 In attesa degli altri...';
      _renderSegments();
      _setStatus('I giocatori stanno registrando...');
      return;
    }

    const char = state.clipMeta?.personaggi?.find(p => p.id === myCharId);
    charBox.innerHTML = '\uD83C\uDF99\uFE0F Stai doppiando: <strong>' + (char ? _esc(char.nome) : myCharId) + '</strong>';

    const battute = char?.battute || [];
    _segments = battute.map(b => ({
      start: b[0],
      end: b[1],
      blob: null,
      originalPcm: null
    }));

    // if no battute, we can just allow them to submit immediately
    if (_segments.length === 0) {
      _segments.push({ start: 0, end: _clipDuration, blob: null, originalPcm: null });
    }

    _renderSegments();
    _setStatus('Seleziona un frammento per iniziare.');
    
    // Extract original waveforms async
    _segments.forEach(async (seg, idx) => {
      try {
        seg.originalPcm = await AudioEngine.renderOriginalVoiceSegment(_myCharId, seg.start, seg.end);
      } catch (e) {
        console.warn('Waveform extraction failed for segment', idx, e);
      }
    });
  }

  function _renderSegments() {
    const listEl = document.getElementById('segments-list');
    if (!_myCharId) {
      listEl.innerHTML = '';
      return;
    }

    listEl.innerHTML = _segments.map((seg, idx) => {
      const isDone = !!seg.blob;
      const isActive = _activeSegmentIndex === idx;
      
      let classes = 'segment-item';
      if (isDone) classes += ' completed';
      if (isActive) classes += ' active';
      
      const tStart = _fmt(seg.start);
      const tEnd = _fmt(seg.end);

      return `
        <div class="${classes}" id="seg-${idx}">
          <div class="segment-info">
            ${isDone ? '✅' : '⏳'} Frammento ${idx + 1} <br/>
            <small style="color:var(--text-muted)">${tStart} - ${tEnd}</small>
          </div>
          <div class="segment-actions">
            <button class="btn btn-secondary" onclick="RecordUI.listenSegment(${idx})" ${isActive ? 'disabled' : ''}>🎧 Ascolta</button>
            <button class="btn ${isDone ? 'btn-ghost' : 'btn-accent'}" onclick="RecordUI.recordSegment(${idx})" ${isActive ? 'disabled' : ''}>🎙️ Registra</button>
          </div>
        </div>
      `;
    }).join('');
    
    _checkSubmitReady();
  }
  
  function _checkSubmitReady() {
    const submitBtn = document.getElementById('btn-submit-takes');
    if (_myCharId && _segments.every(s => s.blob)) {
      submitBtn.hidden = false;
    }
  }

  function _fmt(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return m + ":" + s;
  }

  async function listenSegment(idx) {
    if (_activeSegmentIndex !== -1) return;
    _activeSegmentIndex = idx;
    _mode = 'listen';
    _renderSegments();
    _setStatus('🎧 Ascolto in corso...');
    
    await _playSegment(idx, false);
    
    _activeSegmentIndex = -1;
    _mode = null;
    _renderSegments();
    _setStatus('Pronto.');
  }

  async function recordSegment(idx) {
    if (_activeSegmentIndex !== -1) return;
    _activeSegmentIndex = idx;
    _mode = 'record';
    _renderSegments();
    _setStatus('🎙️ Registrazione in corso...');
    
    AudioEngine.ensureContext();
    const ctx = AudioEngine.getContext();
    await Recorder.init(ctx);
    Recorder.start();

    await _playSegment(idx, true);
    
    const blob = await Recorder.stop();
    _segments[idx].blob = blob;
    
    _activeSegmentIndex = -1;
    _mode = null;
    _renderSegments();
    _setStatus('✅ Registrazione salvata.');
  }

  async function _playSegment(idx, isRecording) {
    const seg = _segments[idx];
    const duration = seg.end - seg.start;
    
    AudioEngine.startSegmentRef(_myCharId, seg.start, isRecording);
    
    const vidEl = document.getElementById('ref-video');
    if (vidEl && vidEl.src && vidEl.src !== window.location.href) {
      vidEl.currentTime = seg.start;
      vidEl.play().catch(()=>{});
    }

    _startTimer(seg.start, seg.end);
    _startWaveformDraw(idx, isRecording);

    // Wait for segment duration
    await new Promise(r => setTimeout(r, duration * 1000));

    AudioEngine.stopAll();
    _stopTimer();
    _stopWaveformDraw();
    if (vidEl) vidEl.pause();
  }

  async function _submitTakes() {
    const submitBtn = document.getElementById('btn-submit-takes');
    submitBtn.disabled = true;
    _setStatus('⏳ Mixaggio dei frammenti e invio...');

    try {
      // 1. Mix blobs into a single 41s WAV ArrayBuffer
      const arrayBuffer = await AudioEngine.mixSegmentsToWav(_segments, _clipDuration);
      
      // 2. Submit to server
      SocketClient.emit('take:submit', { charId: _myCharId, audioData: arrayBuffer });
      _setStatus('✅ Take inviate con successo!');
    } catch (e) {
      console.error(e);
      _setStatus('❌ Errore durante invio: ' + e.message);
      submitBtn.disabled = false;
      return;
    }

    showView('waiting');
    updateWaiting(_state);
  }

  function _startTimer(start, end) {
    _stopTimer();
    const timeEl = document.getElementById('segment-timer');
    const startRealTime = performance.now();
    const duration = end - start;

    _timerInt = setInterval(() => {
      const elapsed = (performance.now() - startRealTime) / 1000;
      let curr = start + elapsed;
      if (curr > end) curr = end;
      timeEl.textContent = _fmt(curr) + " / " + _fmt(end);
    }, 50);
  }

  function _stopTimer() {
    if (_timerInt) { clearInterval(_timerInt); _timerInt = null; }
    const timeEl = document.getElementById('segment-timer');
    if (timeEl) timeEl.textContent = "0:00 / 0:00";
  }

  // --- Waveform drawing ---
  function _startWaveformDraw(idx, isRecording) {
    const canvas = document.getElementById('waveform-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const seg = _segments[idx];
    
    let originalData = null;
    if (seg.originalPcm) {
      originalData = seg.originalPcm.getChannelData(0);
    }
    
    const analyser = isRecording ? Recorder.getAnalyserNode() : null;
    const timeData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    
    const startRealTime = performance.now();
    const durationMs = (seg.end - seg.start) * 1000;
    const W = canvas.width;
    const H = canvas.height;

    const recordedPeaks = new Array(W).fill(0);

    function draw() {
      _animationFrame = requestAnimationFrame(draw);
      
      const elapsedMs = performance.now() - startRealTime;
      const progress = Math.min(1, elapsedMs / durationMs);
      const currentX = progress * W;

      ctx.clearRect(0, 0, W, H);
      
      // Draw original background
      ctx.fillStyle = '#444';
      if (originalData) {
        const step = Math.ceil(originalData.length / W);
        for (let x = 0; x < W; x++) {
          let sum = 0;
          for(let i=0; i<step; i++) {
             sum += Math.abs(originalData[x*step + i] || 0);
          }
          let v = (sum / step) * 3.0; // amplify slightly
          if (v > 1) v = 1;
          const h = v * H;
          ctx.fillRect(x, (H - h) / 2, 1, Math.max(1, h));
        }
      } else {
        ctx.fillRect(0, H/2 - 1, W, 2);
      }

      // Record live mic
      if (isRecording && analyser) {
        analyser.getByteTimeDomainData(timeData);
        let max = 0;
        for (let i = 0; i < timeData.length; i++) {
          const v = Math.abs((timeData[i] - 128) / 128.0);
          if (v > max) max = v;
        }
        const px = Math.floor(currentX);
        if (px >= 0 && px < W) {
           recordedPeaks[px] = Math.max(recordedPeaks[px], max * 2.0); // amplify mic UI
        }
      }

      // Draw recorded peaks
      ctx.fillStyle = '#ff4444';
      for (let x = 0; x < W; x++) {
        if (recordedPeaks[x] > 0) {
          const h = Math.min(1, recordedPeaks[x]) * H;
          ctx.fillRect(x, (H - h) / 2, 1, Math.max(1, h));
        }
      }

      // Draw playhead cursor
      ctx.fillStyle = '#fff';
      ctx.fillRect(currentX, 0, 2, H);
    }
    
    draw();
  }

  function _stopWaveformDraw() {
    if (_animationFrame) {
      cancelAnimationFrame(_animationFrame);
      _animationFrame = null;
    }
    const canvas = document.getElementById('waveform-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }

  function _setupClipDisplay(meta) {
    if (!meta) return;
    const imgEl   = document.getElementById('ref-image');
    const vidEl   = document.getElementById('ref-video');
    const phEl    = document.getElementById('clip-placeholder');
    const url     = meta.video || meta.immagine || '';
    const isVideo = url.match(/\.(mp4|webm|ogv)$/i);
    const isImg   = url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);

    imgEl.style.display = 'none';
    vidEl.style.display = 'none';
    phEl.style.display  = 'none';

    if (isVideo) {
      vidEl.src = url; vidEl.load();
      vidEl.style.display = 'block';
    } else if (isImg) {
      imgEl.src = url;
      imgEl.style.display = 'block';
    } else {
      phEl.style.display = 'block';
    }
  }

  function updateWaiting(state) {
    if (!state?.clipMeta) return;
    const listEl = document.getElementById('waiting-list');
    const assignedChars = state.players
      .filter(p => p.characterId)
      .map(p => ({ player: p, char: state.clipMeta.personaggi?.find(c => c.id === p.characterId) }));

    if (assignedChars.length === 0) {
      listEl.innerHTML = '<div class="waiting-item">Nessun personaggio assegnato.</div>';
      return;
    }
    listEl.innerHTML = assignedChars.map(({ player, char }) => {
      const confirmed = state.confirmedChars.includes(player.characterId);
      return '<div class="waiting-item' + (confirmed ? ' done' : '') + '">' +
        (confirmed ? '✅' : '⏳') + ' ' + _esc(player.name) + ' — ' + (char ? _esc(char.nome) : player.characterId) +
      '</div>';
    }).join('');
  }

  function _setStatus(msg) { document.getElementById('recording-status').textContent = msg; }
  function _esc(s) { return String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  return { beginSession, updateWaiting, listenSegment, recordSegment };
})();
