import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { createWorker } from 'mediasoup';

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

// Mediasoup Configuration
const config = {
  worker: { rtcMinPort: 40000, rtcMaxPort: 49999, logLevel: 'warn' },
  router: {
    mediaCodecs: [
      { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
      { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: {} }
    ],
  },
  webRtcTransport: { listenIps: [{ ip: '0.0.0.0', announcedIp: null }], enableUdp: true, enableTcp: true, preferUdp: true }
};

let worker, router;
(async () => {
  worker = await createWorker(config.worker);
  router = await worker.createRouter({ mediaCodecs: config.router.mediaCodecs });
  console.log('Mediasoup worker and router running');
})();

const waiting = [];
const rooms = {};
io.on('connection', socket => {
  socket.on('join', () => {
    if (waiting.length) {
      const peer = waiting.shift();
      const roomId = `${socket.id}#${peer.id}`;
      rooms[roomId] = { peers: [socket, peer], transports: {}, producers: [] };
      [socket, peer].forEach(s => s.join(roomId));
      io.to(roomId).emit('roomReady', { roomId });
    } else {
      waiting.push(socket);
      socket.emit('waiting');
    }
  });

  socket.on('getRtpCapabilities', (_, cb) => cb(router.rtpCapabilities));

  socket.on('createTransport', async ({ roomId }, cb) => {
    const transport = await router.createWebRtcTransport(config.webRtcTransport);
    rooms[roomId].transports[socket.id] = transport;
    cb({ id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters });
  });

  socket.on('connectTransport', async ({ roomId, dtlsParameters }) => {
    const transport = rooms[roomId].transports[socket.id];
    await transport.connect({ dtlsParameters });
  });

  socket.on('produce', async ({ roomId, kind, rtpParameters }, cb) => {
    const transport = rooms[roomId].transports[socket.id];
    const producer = await transport.produce({ kind, rtpParameters });
    rooms[roomId].producers.push({ producerId: producer.id, socketId: socket.id });
    cb({ id: producer.id });
    // tell peer to consume
    socket.to(roomId).emit('newProducer', { producerId: producer.id });
  });

  socket.on('consume', async ({ roomId, producerId, rtpCapabilities }, cb) => {
    if (!router.canConsume({ producerId, rtpCapabilities })) return cb({ error: 'Cannot consume' });
    const transport = rooms[roomId].transports[socket.id];
    const consumer = await transport.consume({ producerId, rtpCapabilities, paused: false });
    cb({ id: consumer.id, producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
  });

  socket.on('disconnect', () => {
    const roomId = Object.keys(rooms).find(r => rooms[r].peers.some(s => s.id === socket.id));
    if (roomId) {
      rooms[roomId].peers.forEach(s => s.leave(roomId));
      delete rooms[roomId];
    }
  });
});

server.listen(3000, () => console.log('Server running on port 3000')); 
