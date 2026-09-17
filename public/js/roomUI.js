/* public/js/roomUI.js
 * Handles Home, Lobby and Role-Select UI.
 * Reads App.isHost and App.myCharId; emits via SocketClient.
 */
'use strict';

const RoomUI = (() => {

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //  Init (attach one-time listeners)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    // â”€â”€ Volume Control â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const bgAudio = document.getElementById('bg-music');
    const btnMute = document.getElementById('btn-mute');
    const volSlider = document.getElementById('volume-slider');

    btnMute.addEventListener('click', () => {
      bgAudio.muted = !bgAudio.muted;
      btnMute.textContent = bgAudio.muted ? 'ðŸ”‡' : 'ðŸ”Š';
    });

    volSlider.addEventListener('input', (e) => {
      bgAudio.volume = e.target.value;
      if (bgAudio.volume === 0 || bgAudio.volume === "0") {
        bgAudio.muted = true;
        btnMute.textContent = 'ðŸ”‡';
      } else {
        bgAudio.muted = false;
        btnMute.textContent = 'ðŸ”Š';
      }
    });

    // â”€â”€ Home â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const nameInput = document.getElementById('player-name');

    document.getElementById('btn-create').addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!_requireName(name)) return;
      
      const isPrivate = document.getElementById('check-private').checked;
      
      App.myName = name;
      _playMusic();
      SocketClient.emit('room:create', { playerName: name, isPrivate });
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

    // â”€â”€ Lobby â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.getElementById('btn-copy-code').addEventListener('click', () => {
      const code = document.getElementById('room-code-display').textContent;
      navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('btn-copy-code');
        btn.textContent = 'âœ“';
        setTimeout(() => btn.textContent = 'ðŸ“‹', 1500);
      }).catch(() => { /* clipboard not available */ });
    });

    document.getElementById('btn-import-clip').addEventListener('click', () => {
      const url = prompt('Incolla l\\'URL del file JSON (Community Pack):');
      if (url && url.startsWith('http')) {
        SocketClient.emit('clip:import', { url: url.trim() });
      }
    });

    document.getElementById('btn-start-role-select').addEventListener('click', () => {
      const clipId = document.getElementById('clip-select').value;
      if (!clipId) { alert('Seleziona una clip!'); return; }
      SocketClient.emit('clip:select', { clipId });
    });

    // â”€â”€ Role select â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.getElementById('btn-start-recording').addEventListener('click', () => {
      SocketClient.emit('recording:start', {});
    });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //  Lobby render
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function renderLobby(state) {
    document.getElementById('room-code-display').textContent = state.id;

    // Player list
    const listEl = document.getElementById('player-list');
    listEl.innerHTML = state.players.map(p => {
      const isMe   = p.id === SocketClient.getId();
      const isHost = p.id === state.hostId;
      return '<div class="player-card' + (isMe ? ' is-me' : '') + (isHost ? ' is-host' : '') + '">' +
             (isHost ? 'ðŸ‘‘' : 'ðŸŽ­') + ' ' + _esc(p.name) + (isMe ? ' <em>(tu)</em>' : '') +
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

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //  Role Select render
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function renderRoleSelect(state) {
    const titleEl = document.getElementById('clip-title-display');
    titleEl.textContent = state.clipMeta?.titolo || state.clipId || 'Clip';

    const grid = document.getElementById('character-grid');

    if (!state.clipMeta?.personaggi?.length) {
      grid.innerHTML = '<p style="color:var(--muted)">Clip senza personaggi separati â€” traccia audio unica.</p>';
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
        ? 'âœ… Tu'
        : isTaken ? 'ðŸ”’ ' + _esc(assigned.name) : 'ðŸŽ¤ Libero';
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

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //  Role event patch-updates (no full re-render needed)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function onRoleTaken(charId, playerId, playerName) {
    const card = document.querySelector('[data-char-id="' + charId + '"]');
    if (!card) return;
    const isMe = playerId === SocketClient.getId();
    card.classList.toggle('selected', isMe);
    card.classList.toggle('taken',    !isMe);
    card.querySelector('.char-status').textContent = isMe ? 'âœ… Tu' : 'ðŸ”’ ' + playerName;
    if (isMe) App.myCharId = charId;
  }

  function onRoleReleased(charId) {
    const card = document.querySelector('[data-char-id="' + charId + '"]');
    if (!card) return;
    card.classList.remove('selected', 'taken');
    card.querySelector('.char-status').textContent = 'ðŸŽ¤ Libero';
    if (charId === App.myCharId) App.myCharId = null;
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //  Helpers
  // â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function renderPublicRooms(list) {
    const container = document.getElementById('public-rooms-list');
    if (!container) return;
    
    if (!list || list.length === 0) {
      container.innerHTML = '<div class="empty-rooms">Nessuna stanza pubblica disponibile al momento.</div>';
      return;
    }
    
    container.innerHTML = list.map(room => `
      <div class="public-room-item">
        <div class="public-room-info">
          <div class="public-room-name">Stanza di ${_esc(room.hostName)}</div>
          <div class="public-room-count">Giocatori: ${room.playerCount}/${room.maxPlayers}</div>
        </div>
        <button class="btn btn-secondary btn-join-public" data-room-id="${room.id}">Entra</button>
      </div>
    `).join('');
    
    // Attach event listeners to join buttons
    container.querySelectorAll('.btn-join-public').forEach(btn => {
      btn.addEventListener('click', () => {
        const nameInput = document.getElementById('player-name');
        const name = nameInput.value.trim();
        if (!_requireName(name)) return;
        
        App.myName = name;
        _playMusic();
        SocketClient.emit('room:join', { roomId: btn.dataset.roomId, playerName: name });
      });
    });
  }

  function _requireName(name) {
    if (!name) { alert('Inserisci il tuo nome!'); return false; }
    return true;
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, renderLobby, renderRoleSelect, onRoleTaken, onRoleReleased, renderPublicRooms };
})();

