const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mediasoup = require('mediasoup');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let worker, router;
const transports = {};
const producers  = {};
const consumers  = {};

(async () => {
  worker = await mediasoup.createWorker();
  router = await worker.createRouter({
    mediaCodecs: [
      { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
      { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 }
    ]
  });
})();

app.use(express.static('public'));

io.on('connection', socket => {
  // 1) expose router rtpCapabilities
  socket.on('getRouterRtpCapabilities', (_, cb) => cb(router.rtpCapabilities));

  // 2) create producer transport
  socket.on('createProducerTransport', async (_, cb) => {
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    });
    transports[socket.id] = transports[socket.id] || {};
    transports[socket.id].producerTransport = transport;
    cb({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  });

  // 3) connect producer transport
  socket.on('connectProducerTransport', async ({ dtlsParameters }, cb) => {
    const transport = transports[socket.id].producerTransport;
    await transport.connect({ dtlsParameters });
    cb();
  });

  // 4) produce track
  socket.on('produce', async ({ kind, rtpParameters }, cb) => {
    const transport = transports[socket.id].producerTransport;
    const producer  = await transport.produce({ kind, rtpParameters });
    producers[producer.id] = { producer, socketId: socket.id };
    cb({ id: producer.id });
    socket.broadcast.emit('newProducer', { producerId: producer.id });
  });

  // 5) create consumer transport
  socket.on('createConsumerTransport', async (_, cb) => {
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    });
    transports[socket.id] = transports[socket.id] || {};
    transports[socket.id].consumerTransport = transport;
    cb({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  });

  // 6) connect consumer transport
  socket.on('connectConsumerTransport', async ({ dtlsParameters }, cb) => {
    const transport = transports[socket.id].consumerTransport;
    await transport.connect({ dtlsParameters });
    cb();
  });

  // 7) consume a producer
  socket.on('consume', async ({ producerId, rtpCapabilities }, cb) => {
    if (!router.canConsume({ producerId, rtpCapabilities }))
      return cb({ error: 'cannotConsume' });

    const transport = transports[socket.id].consumerTransport;
    const consumer  = await transport.consume({ producerId, rtpCapabilities, paused: false });
    consumers[consumer.id] = { consumer, socketId: socket.id };
    cb({
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    });
  });

  // 8) resume consumer (optional)
  socket.on('resumeConsumer', async ({ consumerId }, cb) => {
    const data = consumers[consumerId];
    if (data) await data.consumer.resume();
    cb();
  });

  // 9) cleanup on disconnect
  socket.on('disconnect', () => {
    const entry = transports[socket.id];
    entry?.producerTransport?.close();
    entry?.consumerTransport?.close();
    delete transports[socket.id];
    // ... also close producers/consumers linked to this socket ...
  });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));