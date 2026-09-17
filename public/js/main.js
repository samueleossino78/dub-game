/* public/js/main.js
 * Application state machine and Socket event router.
 * showView(), App object, and socket handler registration are all global
 * so sibling modules (roomUI, recordUI, playbackUI) can access them.
 */
'use strict';

// ────────────────────────────────────────────────
//  Global App State
// ────────────────────────────────────────────────
const App = {
  myName:              '',
  isHost:              false,
  roomId:              null,
  /** @type {RoomStateSerialized|null} */
  currentRoom:         null,
  myCharId:            null,
  /** charId → ArrayBuffer (received from server) */
  dubbedTakes:         {},
  /** True while the recording phase is active for this client */
  recordingActive:     false,
};

// ────────────────────────────────────────────────
//  View Machine
// ────────────────────────────────────────────────
const VIEWS = ['home', 'lobby', 'role-select', 'recording', 'waiting', 'playback'];

/** Shows one view, hides all others. Safe to call from any module. */
function showView(name) {
  VIEWS.forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.hidden = (v !== name);
  });
}

// ────────────────────────────────────────────────
//  Host-only UI visibility helper
// ────────────────────────────────────────────────
function applyHostVisibility(isHost) {
  document.querySelectorAll('.host-only').forEach(el => el.hidden = !isHost);
  document.querySelectorAll('.non-host-only').forEach(el => el.hidden = isHost);
}

// ────────────────────────────────────────────────
//  Socket Event Handlers
// ────────────────────────────────────────────────
function _registerSocketHandlers() {

  // ── Joined a room ───────────────────────────────
  SocketClient.on('room:joined', ({ roomId, isHost }) => {
    App.roomId = roomId;
    App.isHost = isHost;
    // room:state will arrive right after and populate currentRoom
  });

  // ── Room state broadcast (source of truth) ───────────
  SocketClient.on('room:state', state => {
    App.currentRoom = state;

    // Resolve host flag from state (handles promotions)
    if (state.hostId === SocketClient.getId()) App.isHost = true;

    // Resolve own character from state
    const me = state.players.find(p => p.id === SocketClient.getId());
    if (me) App.myCharId = me.characterId;

    switch (state.phase) {

      case 'lobby':
        showView('lobby');
        applyHostVisibility(App.isHost);
        RoomUI.renderLobby(state);
        break;

      case 'role_select':
        showView('role-select');
        applyHostVisibility(App.isHost);
        RoomUI.renderRoleSelect(state);
        // Preload audio assets as soon as clip is known
        if (state.clipMeta && !AudioEngine.getClipMeta()) {
          AudioEngine.loadClip(state.clipMeta).catch(e =>
            console.warn('[main] Audio preload failed:', e)
          );
        }
        break;

      case 'recording':
        // Guard: only enter once per phase
        if (!App.recordingActive) {
          App.recordingActive = true;
          showView('recording');
          applyHostVisibility(App.isHost);
          RecordUI.beginSession(state, App.myCharId);
        }
        break;

      case 'playback':
        // handled by all:confirmed
        break;
    }

    // Keep waiting list fresh
    if (!document.getElementById('view-waiting').hidden) {
      RecordUI.updateWaiting(state);
    }
  });

  // ── Role updates ────────────────────────────────
  SocketClient.on('role:taken', ({ charId, playerId, playerName }) => {
    RoomUI.onRoleTaken(charId, playerId, playerName);
  });

  SocketClient.on('role:released', ({ charId }) => {
    RoomUI.onRoleReleased(charId);
  });

  // ── Take confirmations ────────────────────────────
  SocketClient.on('take:confirmed', () => {
    // room:state arrives simultaneously with updated confirmedChars
    if (!document.getElementById('view-waiting').hidden && App.currentRoom) {
      RecordUI.updateWaiting(App.currentRoom);
    }
  });

  // ── All done → playback! ──────────────────────────
  SocketClient.on('all:confirmed', ({ takes }) => {
    App.dubbedTakes   = takes;
    App.recordingActive = false;
    showView('playback');
    PlaybackUI.init(App.currentRoom, takes);
  });

  // ── Host promotion ──────────────────────────────
  SocketClient.on('room:promoted', () => {
    App.isHost = true;
    applyHostVisibility(true);
  });

  // ── Errors ──────────────────────────────────────
  SocketClient.on('room:error', ({ message }) => {
    alert("Errore: " + message);
  });

  SocketClient.on('role:error', ({ message }) => {
    alert("Errore ruolo: " + message);
  });
}

// ────────────────────────────────────────────────
//  Bootstrap
// ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  SocketClient.connect();
  _registerSocketHandlers();
  RoomUI.init();
  showView('home');
  applyHostVisibility(false);
});
