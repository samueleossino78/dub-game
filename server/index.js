'use strict';

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');

const ClipRegistry = require('./clipRegistry');
const RoomManager  = require('./roomManager');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  maxHttpBufferSize: 50e6,   // 50 MB — enough for ~5 min of Opus audio
  cors: { origin: '*' },
});

const clipRegistry = new ClipRegistry();
const roomManager  = new RoomManager(io, clipRegistry);

// ── Static assets ────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

// ── REST ─────────────────────────────────────────
app.get('/api/clips', (_req, res) => {
  res.json(clipRegistry.listClips());
});

// ── Socket.io ────────────────────────────────────
io.on('connection', socket => {
  console.log(`[+] ${socket.id}`);

  socket.emit('rooms:public_list', roomManager.getPublicRoomsList());

  socket.on('room:create', ({ playerName, isPrivate } = {}) => {
    roomManager.createRoom(socket, (playerName || 'Anonimo').trim().slice(0, 20), !!isPrivate);
  });

  socket.on('room:join', ({ roomId, playerName } = {}) => {
    roomManager.joinRoom(
      socket,
      (roomId || '').toUpperCase().trim(),
      (playerName || 'Anonimo').trim().slice(0, 20)
    );
  });

  socket.on('clip:import', ({ url } = {}) => {
    roomManager.importClip(socket, url);
  });

  socket.on('clip:select', ({ clipId } = {}) => {
    roomManager.selectClip(socket, clipId);
  });

  socket.on('role:select', ({ charId } = {}) => {
    roomManager.selectCharacter(socket, charId);
  });

  socket.on('role:release', () => {
    roomManager.releaseCharacter(socket);
  });

  socket.on('room:reset', () => {
    roomManager.resetRoom(socket);
  });

  socket.on('recording:start', () => {
    roomManager.startRecording(socket);
  });

  // audioData arrives as ArrayBuffer from browser
  socket.on('take:submit', ({ charId, audioData } = {}) => {
    if (!charId || !audioData) return;
    roomManager.submitTake(socket, charId, audioData);
  });

  socket.on('disconnect', reason => {
    console.log(`[-] ${socket.id} (${reason})`);
    roomManager.handleDisconnect(socket);
  });
});

// ── Start ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎬  DubGame Supremo  →  http://localhost:${PORT}`);
});
