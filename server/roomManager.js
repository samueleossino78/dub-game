'use strict';

const { randomBytes } = require('crypto');

class RoomManager {
  constructor(io, clipRegistry) {
    this.io = io;
    this.clipRegistry = clipRegistry;
    /** @type {Map<string, RoomState>} */
    this.rooms = new Map();
    /** @type {Map<string, string>} socketId → roomId */
    this.socketToRoom = new Map();
  }

  // ────────────────────────────────────────────────
  //  Internal helpers
  // ────────────────────────────────────────────────

  _generateRoomId() {
    return randomBytes(3).toString('hex').toUpperCase();
  }

  _getRoom(socketId) {
    const roomId = this.socketToRoom.get(socketId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  _serializeRoom(room) {
    return {
      id:             room.id,
      phase:          room.phase,
      hostId:         room.hostId,
      isPrivate:      room.isPrivate,
      clipId:         room.clipId,
      clipMeta:       room.clipMeta || null,
      players:        Array.from(room.players.values()).map(p => ({
        id:          p.id,
        name:        p.name,
        characterId: p.characterId,
      })),
      confirmedChars: Array.from(room.confirmedTakes.keys()),
    };
  }

  _broadcastState(room) {
    this.io.to(room.id).emit('room:state', this._serializeRoom(room));
  }

  _broadcastPublicRooms() {
    const list = [];
    for (const room of this.rooms.values()) {
      if (!room.isPrivate && room.phase === 'lobby' && room.players.size < 5) {
        const host = room.players.get(room.hostId);
        list.push({
          id: room.id,
          hostName: host ? host.name : 'Sconosciuto',
          playerCount: room.players.size,
          maxPlayers: 5
        });
      }
    }
    this.io.emit('rooms:public_list', list);
  }

  getPublicRoomsList() {
    const list = [];
    for (const room of this.rooms.values()) {
      if (!room.isPrivate && room.phase === 'lobby' && room.players.size < 5) {
        const host = room.players.get(room.hostId);
        list.push({
          id: room.id,
          hostName: host ? host.name : 'Sconosciuto',
          playerCount: room.players.size,
          maxPlayers: 5
        });
      }
    }
    return list;
  }

  // ────────────────────────────────────────────────
  //  Public API (called from index.js socket handlers)
  // ────────────────────────────────────────────────

  createRoom(socket, playerName, isPrivate = false) {
    const roomId = this._generateRoomId();
    /** @type {RoomState} */
    const room = {
      id:             roomId,
      hostId:         socket.id,
      isPrivate:      isPrivate,
      phase:          'lobby',
      clipId:         null,
      clipMeta:       null,
      players:        new Map([[socket.id, { id: socket.id, name: playerName, characterId: null }]]),
      confirmedTakes: new Map(),
    };

    this.rooms.set(roomId, room);
    this.socketToRoom.set(socket.id, roomId);
    socket.join(roomId);

    socket.emit('room:joined', { roomId, isHost: true });
    this._broadcastState(room);
    this._broadcastPublicRooms();
    console.log(`[Room] Created ${isPrivate ? 'Private' : 'Public'} ${roomId} by ${playerName} (${socket.id})`);
  }

  joinRoom(socket, roomId, playerName) {
    const room = this.rooms.get(roomId);
    if (!room) {
      socket.emit('room:error', { message: `Stanza "${roomId}" non trovata.` });
      return;
    }
    if (room.phase !== 'lobby') {
      socket.emit('room:error', { message: 'La partita è già in corso. Aspetta la prossima.' });
      return;
    }
    if (room.players.size >= 5) {
      socket.emit('room:error', { message: 'La stanza è piena (massimo 5 giocatori).' });
      return;
    }

    room.players.set(socket.id, { id: socket.id, name: playerName, characterId: null });
    this.socketToRoom.set(socket.id, roomId);
    socket.join(roomId);

    socket.emit('room:joined', { roomId, isHost: false });
    this._broadcastState(room);
    this._broadcastPublicRooms();
    console.log(`[Room] ${playerName} joined ${roomId}`);
  }

  selectClip(socket, clipId) {
    const room = this._getRoom(socket.id);
    if (!room || room.hostId !== socket.id) return;

    const meta = this.clipRegistry.getClipMeta(clipId);
    if (!meta) {
      socket.emit('room:error', { message: `Clip "${clipId}" non trovata.` });
      return;
    }

    room.clipId   = clipId;
    room.clipMeta = meta;
    room.phase    = 'role_select';

    // Reset assignments and takes
    for (const player of room.players.values()) player.characterId = null;
    room.confirmedTakes.clear();

    this._broadcastState(room);
    this._broadcastPublicRooms();
  }

  selectCharacter(socket, charId) {
    const room = this._getRoom(socket.id);
    if (!room || room.phase !== 'role_select') return;
    if (!room.clipMeta?.personaggi?.find(p => p.id === charId)) {
      socket.emit('role:error', { message: 'Personaggio non valido.' });
      return;
    }

    // Check if someone else already has this character
    for (const [pid, player] of room.players) {
      if (player.characterId === charId && pid !== socket.id) {
        socket.emit('role:error', { message: `${charId} è già occupato da ${player.name}.` });
        return;
      }
    }

    const me      = room.players.get(socket.id);
    const prevChar = me.characterId;
    me.characterId = charId;

    if (prevChar) this.io.to(room.id).emit('role:released', { charId: prevChar });
    this.io.to(room.id).emit('role:taken', { charId, playerId: socket.id, playerName: me.name });
    this._broadcastState(room);
  }

  releaseCharacter(socket) {
    const room = this._getRoom(socket.id);
    if (!room) return;
    const me = room.players.get(socket.id);
    if (!me?.characterId) return;

    const charId  = me.characterId;
    me.characterId = null;
    this.io.to(room.id).emit('role:released', { charId });
    this._broadcastState(room);
  }

  startRecording(socket) {
    const room = this._getRoom(socket.id);
    if (!room || room.hostId !== socket.id || room.phase !== 'role_select') return;

    room.phase = 'recording';
    room.confirmedTakes.clear();
    this._broadcastState(room);
    this._broadcastPublicRooms();
    console.log(`[Room] ${room.id} → recording`);
  }

  submitTake(socket, charId, audioData) {
    const room = this._getRoom(socket.id);
    if (!room || room.phase !== 'recording') return;

    const me = room.players.get(socket.id);
    if (!me || me.characterId !== charId) {
      console.warn(`[Room] submitTake mismatch: ${socket.id} tried to submit for ${charId}`);
      return;
    }

    room.confirmedTakes.set(charId, Buffer.from(audioData));
    this.io.to(room.id).emit('take:confirmed', { charId, playerName: me.name });
    this._broadcastState(room);
    console.log(`[Room] ${me.name} confirmed take for ${charId}`);

    // Check if all assigned chars have submitted
    const assignedChars = Array.from(room.players.values())
      .map(p => p.characterId)
      .filter(Boolean);

    if (assignedChars.length > 0 && assignedChars.every(cid => room.confirmedTakes.has(cid))) {
      room.phase = 'playback';
      // Build takes payload
      const takes = {};
      for (const [cid, buf] of room.confirmedTakes) takes[cid] = buf;
      this.io.to(room.id).emit('all:confirmed', { takes });
      this._broadcastState(room);
      console.log(`[Room] ${room.id} → all confirmed, playback!`);
    }
  }

  resetRoom(socket) {
    const room = this._getRoom(socket.id);
    if (!room || room.hostId !== socket.id) return;

    room.phase = 'lobby';
    room.clipId = null;
    room.clipMeta = null;
    for (const player of room.players.values()) player.characterId = null;
    room.confirmedTakes.clear();

    this._broadcastState(room);
    this._broadcastPublicRooms();
    console.log(`[Room] ${room.id} reset to lobby`);
  }

  handleDisconnect(socket) {
    const room = this._getRoom(socket.id);
    if (!room) return;

    const me     = room.players.get(socket.id);
    const charId  = me?.characterId;

    room.players.delete(socket.id);
    this.socketToRoom.delete(socket.id);

    // Promote new host if needed
    if (room.hostId === socket.id && room.players.size > 0) {
      const next = room.players.values().next().value;
      room.hostId = next.id;
      this.io.to(next.id).emit('room:promoted', {});
      console.log(`[Room] ${next.name} promoted to host in ${room.id}`);
    }

    // Release character if disconnected during recording
    if (charId && room.phase === 'recording') {
      room.confirmedTakes.delete(charId);
      this.io.to(room.id).emit('role:released', { charId });
      console.log(`[Room] ${charId} released due to disconnect`);
    }

    if (room.players.size === 0) {
      this.rooms.delete(room.id);
      console.log(`[Room] ${room.id} destroyed (empty)`);
    } else {
      this._broadcastState(room);
    }

    this._broadcastPublicRooms();
  }
}

module.exports = RoomManager;
