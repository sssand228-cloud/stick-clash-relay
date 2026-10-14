const net = require('net');

const PORT = Number(process.env.PORT || 27656);
const rooms = new Map();

function safeCode(v) {
  return String(v || '')
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 12);
}

function send(socket, line) {
  if (socket && !socket.destroyed) {
    socket.write(line + '\n');
  }
}

function destroy(socket) {
  try {
    if (socket && !socket.destroyed) {
      socket.destroy();
    }
  } catch (_) {}
}

const server = net.createServer((socket) => {
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 15000);

  let buffer = '';
  let role = '';
  let code = '';
  let peer = null;
  let ready = false;

  function cleanup() {
    if (role === 'HOST' && rooms.get(code) === socket) {
      rooms.delete(code);
    }

    if (peer && !peer.destroyed) {
      destroy(peer);
    }
  }

  socket.on('data', (chunk) => {
    if (!ready && socket._ready && socket._peer) {
      ready = true;
      peer = socket._peer;
    }

    buffer += chunk.toString('utf8');

    if (buffer.length > 65536) {
      return destroy(socket);
    }

    let idx;

    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer
        .slice(0, idx)
        .replace(/\r/g, '');

      buffer = buffer.slice(idx + 1);

      if (ready) {
        if (peer && !peer.destroyed) {
          send(peer, line);
        }
        continue;
      }

      const [cmdRaw, codeRaw] = line.trim().split(/\s+/, 2);

      const cmd = String(cmdRaw || '').toUpperCase();
      code = safeCode(codeRaw);

      if (!code) {
        send(socket, 'ERR BAD_CODE');
        return destroy(socket);
      }

      if (cmd === 'HOST') {
        role = 'HOST';

        const old = rooms.get(code);

        if (old && old !== socket) {
          destroy(old);
        }

        rooms.set(code, socket);
        send(socket, 'WAIT');
        return;
      }

      if (cmd === 'JOIN') {
        role = 'JOIN';

        const host = rooms.get(code);

        if (!host || host.destroyed) {
          send(socket, 'ERR ROOM_NOT_FOUND');
          return destroy(socket);
        }

        rooms.delete(code);

        peer = host;

        socket._peer = host;
        host._peer = socket;

        socket._ready = true;
        host._ready = true;

        ready = true;

        send(host, 'OK');
        send(socket, 'OK');

        return;
      }

      send(socket, 'ERR BAD_COMMAND');
      return destroy(socket);
    }

    if (!ready && socket._ready && socket._peer) {
      ready = true;
      peer = socket._peer;
    }
  });

  socket.on('close', cleanup);
  socket.on('error', cleanup);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Stick Clash relay listening on ${PORT}`);
});
