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
  maxHttpBufferSize: 50e6,   // 50 MB â€” enough for ~5 min of Opus audio
  cors: { origin: '*' },
});

const clipRegistry = new ClipRegistry();
const roomManager  = new RoomManager(io, clipRegistry);

// â”€â”€ Static assets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

// â”€â”€ REST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/clips', (_req, res) => {
  res.json(clipRegistry.listClips());
});

// â”€â”€ Socket.io â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
io.on('connection', socket => {
  console.log(`[+] ${socket.id}`);

  // Invia sÃ¹bito la lista pubblica al client appena connesso
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

// â”€â”€ Start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ðŸŽ¬  DubGame Supremo  â†’  http://localhost:${PORT}`);
});

