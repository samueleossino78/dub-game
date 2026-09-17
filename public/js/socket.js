/* public/js/socket.js
 * Thin wrapper around Socket.io client.
 * Exposes a simple on/emit interface used by all other modules.
 */
'use strict';

const SocketClient = (() => {
  let _socket = null;

  function connect() {
    _socket = io({
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });
    _socket.on('connect',       () => console.log('[Socket] connected:', _socket.id));
    _socket.on('disconnect', reason => console.log('[Socket] disconnected:', reason));
    _socket.on('connect_error',  err => console.error('[Socket] error:', err.message));
    return _socket;
  }

  function on(event, fn)       { _socket?.on(event, fn); }
  function off(event, fn)      { _socket?.off(event, fn); }
  function emit(event, data)   { _socket?.emit(event, data); }
  function getId()             { return _socket?.id ?? null; }
  function isConnected()       { return !!_socket?.connected; }

  return { connect, on, off, emit, getId, isConnected };
})();
