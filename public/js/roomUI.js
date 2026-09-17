/* public/js/roomUI.js
 * Handles Home, Lobby and Role-Select UI.
 * Reads App.isHost and App.myCharId; emits via SocketClient.
 */
'use strict';

const RoomUI = (() => {

  // ────────────────────────────────────────────────
  //  Init (attach one-time listeners)
  // ────────────────────────────────────────────────
  function _playMusic() {
    const audio = document.getElementById('bg-music');
    if (audio && audio.paused) {
      audio.volume = 0.5; // volume al 50%
      audio.play().catch(e => console.warn('Autoplay blocked:', e));
    }
  }

  // Tenta di farla partire al primo clic qualsiasi sullo schermo
  document.addEventListener('click', _playMusic, { once: true });

  function init() {
    // ── Home ────────────────────────────────────────
    const nameInput = document.getElementById('player-name');

    document.getElementById('btn-create').addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!_requireName(name)) return;
      App.myName = name;
      _playMusic();
      SocketClient.emit('room:create', { playerName: name });
    });

    document.getElementById('btn-join').addEventListener('click', () => {
      const name = nameInput.value.trim();
      const code = document.getElementById('room-code-input').value.trim().toUpperCase();
      if (!_requireName(name)) return;
      if (!code) { alert('Inserisci il codice stanza!'); return; }
      App.myName = name;
      _playMusic();
      SocketClient.emit('room:join', { roomId: code, playerName: name });
    });

    // Allow Enter key in room code field
    document.getElementById('room-code-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-join').click();
    });
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-create').click();
    });

    // ── Lobby ───────────────────────────────────────
    document.getElementById('btn-copy-code').addEventListener('click', () => {
      const code = document.getElementById('room-code-display').textContent;
      navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('btn-copy-code');
        btn.textContent = '✓';
        setTimeout(() => btn.textContent = '📋', 1500);
      }).catch(() => { /* clipboard not available */ });
    });

    document.getElementById('btn-start-role-select').addEventListener('click', () => {
      const clipId = document.getElementById('clip-select').value;
      if (!clipId) { alert('Seleziona una clip!'); return; }
      SocketClient.emit('clip:select', { clipId });
    });

    // ── Role select ───────────────────────────────────
    document.getElementById('btn-start-recording').addEventListener('click', () => {
      SocketClient.emit('recording:start', {});
    });
  }

  // ────────────────────────────────────────────────
  //  Lobby render
  // ────────────────────────────────────────────────
  async function renderLobby(state) {
    document.getElementById('room-code-display').textContent = state.id;

    // Player list
    const listEl = document.getElementById('player-list');
    listEl.innerHTML = state.players.map(p => {
      const isMe   = p.id === SocketClient.getId();
      const isHost = p.id === state.hostId;
      return '<div class="player-card' + (isMe ? ' is-me' : '') + (isHost ? ' is-host' : '') + '">' +
             (isHost ? '👑' : '🎭') + ' ' + _esc(p.name) + (isMe ? ' <em>(tu)</em>' : '') +
             '</div>';
    }).join('');

    // Clip selector (host only, load once)
    if (App.isHost) {
      const sel = document.getElementById('clip-select');
      if (sel.options.length <= 1 || sel.options[0].value === '') {
        try {
          const res   = await fetch('/api/clips');
          const clips = await res.json();
          sel.innerHTML = clips.length
            ? clips.map(c => '<option value="' + _esc(c.id) + '">' + _esc(c.titolo) + '</option>').join('')
            : '<option value="">-- Nessuna clip trovata --</option>';
        } catch {
          sel.innerHTML = '<option value="">-- Errore caricamento --</option>';
        }
      }
    }
  }

  // ────────────────────────────────────────────────
  //  Role Select render
  // ────────────────────────────────────────────────
  function renderRoleSelect(state) {
    const titleEl = document.getElementById('clip-title-display');
    titleEl.textContent = state.clipMeta?.titolo || state.clipId || 'Clip';

    const grid = document.getElementById('character-grid');

    if (!state.clipMeta?.personaggi?.length) {
      grid.innerHTML = '<p style="color:var(--muted)">Clip senza personaggi separati — traccia audio unica.</p>';
      return;
    }

    // Build assignment map
    const byChar = {};
    state.players.forEach(p => { if (p.characterId) byChar[p.characterId] = p; });

    grid.innerHTML = state.clipMeta.personaggi.map(char => {
      const assigned = byChar[char.id];
      const isMe     = assigned?.id === SocketClient.getId();
      const isTaken  = !!assigned && !isMe;
      const cls      = isMe ? 'selected' : isTaken ? 'taken' : '';
      const status   = isMe
        ? '✅ Tu'
        : isTaken ? '🔒 ' + _esc(assigned.name) : '🎤 Libero';
      return '<div class="char-card ' + cls + '" data-char-id="' + _esc(char.id) + '">' +
               '<div class="char-name">' + _esc(char.nome) + '</div>' +
               '<div class="char-status">' + status + '</div>' +
             '</div>';
    }).join('');

    // Attach click handlers
    grid.querySelectorAll('.char-card').forEach(card => {
      card.addEventListener('click', () => {
        if (card.classList.contains('taken')) return;
        const charId = card.dataset.charId;
        if (charId === App.myCharId) {
          SocketClient.emit('role:release', {});
        } else {
          SocketClient.emit('role:select', { charId });
        }
      });
    });

    // Host button visibility
    const btnRec = document.getElementById('btn-start-recording');
    if (btnRec) btnRec.hidden = !App.isHost;
  }

  // ────────────────────────────────────────────────
  //  Role event patch-updates (no full re-render needed)
  // ────────────────────────────────────────────────
  function onRoleTaken(charId, playerId, playerName) {
    const card = document.querySelector('[data-char-id="' + charId + '"]');
    if (!card) return;
    const isMe = playerId === SocketClient.getId();
    card.classList.toggle('selected', isMe);
    card.classList.toggle('taken',    !isMe);
    card.querySelector('.char-status').textContent = isMe ? '✅ Tu' : '🔒 ' + playerName;
    if (isMe) App.myCharId = charId;
  }

  function onRoleReleased(charId) {
    const card = document.querySelector('[data-char-id="' + charId + '"]');
    if (!card) return;
    card.classList.remove('selected', 'taken');
    card.querySelector('.char-status').textContent = '🎤 Libero';
    if (charId === App.myCharId) App.myCharId = null;
  }

  // ────────────────────────────────────────────────
  //  Helpers
  // ────────────────────────────────────────────────
  function _requireName(name) {
    if (!name) { alert('Inserisci il tuo nome!'); return false; }
    return true;
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, renderLobby, renderRoleSelect, onRoleTaken, onRoleReleased };
})();
