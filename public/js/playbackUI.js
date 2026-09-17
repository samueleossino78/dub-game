/* public/js/playbackUI.js
 * Manages the Final Playback view ("La Prima Visione").
 * Renders cast list, handles play button, drives progress bar.
 */
'use strict';

const PlaybackUI = (() => {
  let _state    = null;
  let _takes    = null;
  let _playing  = false;
  let _progInt  = null;

  // ────────────────────────────────────────────────
  //  Init
  // ────────────────────────────────────────────────
  function init(state, takes) {
    _state  = state;
    _takes  = takes;
    _playing = false;

    // Setup clip visual
    _setupVisual(state.clipMeta);

    // Cast list
    _renderCast(state);

    // Buttons
    const btnPlay  = document.getElementById('btn-play-all');
    const btnAgain = document.getElementById('btn-play-again');
    btnPlay.disabled     = false;
    btnPlay.textContent  = '▶️ Rivedi il Video';
    btnAgain.hidden      = !App.isHost;
    btnAgain.textContent = '🔄 Nuova Partita';
    btnPlay.onclick      = () => _playAll();
    btnAgain.onclick     = () => SocketClient.emit('room:reset');
  }

  // ────────────────────────────────────────────────
  //  Play All
  // ────────────────────────────────────────────────
  async function _playAll() {
    if (_playing) { AudioEngine.stopAll(); _playing = false; }
    _playing = true;

    const btnPlay  = document.getElementById('btn-play-all');
    const btnAgain = document.getElementById('btn-play-again');
    btnPlay.disabled    = true;
    btnPlay.textContent = '⏳ Caricamento...';

    try {
      const assignedCharIds = _state.players
        .filter(p => p.characterId)
        .map(p => p.characterId);

      // Convert takes to ArrayBuffers (Socket.io may send Uint8Array or plain objects)
      const normalizedTakes = {};
      for (const [charId, data] of Object.entries(_takes)) {
        normalizedTakes[charId] = _toArrayBuffer(data);
      }

      const { startAt, duration } = await AudioEngine.startFinalPlayback(normalizedTakes, assignedCharIds);

      // Try to play any video element
      const vidEl = document.getElementById('final-video');
      if (vidEl.src && vidEl.src !== window.location.href) {
        vidEl.currentTime = 0;
        vidEl.play().catch(() => { /* autoplay blocked for video — ok, audio plays */ });
      }

      // Progress bar
      const progContainer = document.getElementById('playback-progress-container');
      const progBar       = document.getElementById('playback-progress-bar');
      progContainer.hidden = false;
      progBar.style.width  = '0%';
      _stopProgress();

      _progInt = setInterval(() => {
        const ctx     = AudioEngine.getContext();
        if (!ctx) return;
        const elapsed = Math.min(ctx.currentTime - startAt, duration);
        progBar.style.width = ((elapsed / duration) * 100) + '%';
        if (elapsed >= duration) _stopProgress();
      }, 50);

      btnPlay.disabled    = false;
      btnPlay.textContent = '▶️ Rivedi il Video';
      btnAgain.hidden     = false;

      // Auto-stop after duration
      setTimeout(() => {
        AudioEngine.stopAll();
        if (vidEl.src) { vidEl.pause(); vidEl.currentTime = 0; }
        _playing = false;
        _stopProgress();
      }, (duration + 0.8) * 1000);

    } catch (err) {
      console.error('[PlaybackUI] Error:', err);
      btnPlay.disabled    = false;
      btnPlay.textContent = '▶️ Rivedi il Video';
      _playing = false;
    }
  }

  // ────────────────────────────────────────────────
  //  Clip visual
  // ────────────────────────────────────────────────
  function _setupVisual(meta) {
    if (!meta) return;
    const imgEl  = document.getElementById('final-image');
    const vidEl  = document.getElementById('final-video');
    const phEl   = document.getElementById('playback-placeholder');
    const url    = meta.video || meta.immagine || '';
    const isVid  = url.match(/\.(mp4|webm|ogv)$/i);
    const isImg  = url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);

    imgEl.style.display = 'none';
    vidEl.style.display = 'none';
    phEl.style.display  = 'none';

    if (isVid)      { vidEl.src = url; vidEl.load(); vidEl.style.display = 'block'; }
    else if (isImg) { imgEl.src = url; imgEl.style.display = 'block'; }
    else            { phEl.style.display = 'block'; }
  }

  // ────────────────────────────────────────────────
  //  Cast list
  // ────────────────────────────────────────────────
  function _renderCast(state) {
    const castEl = document.getElementById('cast-list');
    if (!state.clipMeta?.personaggi) { castEl.innerHTML = ''; return; }

    const byChar = {};
    state.players.forEach(p => { if (p.characterId) byChar[p.characterId] = p; });

    castEl.innerHTML = state.clipMeta.personaggi.map(char => {
      const player  = byChar[char.id];
      const dubbed  = !!player;
      const label   = dubbed
        ? '<span class="cast-dubbed">🎤 ' + _esc(player.name) + '</span>'
        : '<span class="cast-original">🔈 Voce originale</span>';
      return '<div class="cast-item">' + _esc(char.nome) + ': ' + label + '</div>';
    }).join('');
  }

  // ────────────────────────────────────────────────
  //  Helpers
  // ────────────────────────────────────────────────
  function _stopProgress() {
    if (_progInt) { clearInterval(_progInt); _progInt = null; }
  }

  function _toArrayBuffer(data) {
    if (data instanceof ArrayBuffer)  return data;
    if (data instanceof Uint8Array)   return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    if (Array.isArray(data))          return new Uint8Array(data).buffer;
    if (data && typeof data === 'object' && !ArrayBuffer.isView(data)) {
      // Plain object with numeric keys (Socket.io serialisation edge case)
      const keys = Object.keys(data);
      const arr  = new Uint8Array(keys.length);
      keys.forEach(k => arr[+k] = data[k]);
      return arr.buffer;
    }
    return data;
  }

  function _esc(s) {
    return String(s).replace(/[<>&"]/g, c =>
      ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  }

  return { init };
})();
