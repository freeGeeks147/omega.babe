const express    = require('express');
const http       = require('http');
const socketIo   = require('socket.io');
const mediasoup  = require('mediasoup');

const app    = express();
const server = http.createServer(app);
const io     = socketIo(server);
const PORT   = process.env.PORT || 3000;

let worker, router;
const transports = {};

;(async () => {
  worker = await mediasoup.createWorker();
  router = await worker.createRouter({
    mediaCodecs: [
      { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
      { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 }
    ]
  });
})();

// Serve static files from /public
app.use(express.static('public'));

io.on('connection', socket => {
  // 1) send rtpCapabilities
  socket.on('getRouterRtpCapabilities', (_, cb) => {
    cb(router.rtpCapabilities);
  });

  // 2) create producer transport
  socket.on('createProducerTransport', async (_, cb) => {
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    });
    transports[socket.id] = transports[socket.id] || {};
    transports[socket.id].producer = transport;
    cb({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  });

  // 3) connect & produce
  socket.on('connectProducerTransport', async ({ dtlsParameters }, cb) => {
    await transports[socket.id].producer.connect({ dtlsParameters });
    cb();
  });
  socket.on('produce', async ({ kind, rtpParameters }, cb) => {
    const proc = await transports[socket.id].producer.produce({ kind, rtpParameters });
    // tell everyone about the new producer
    io.emit('newProducer', { producerId: proc.id });
    cb({ id: proc.id });
  });

  // 4) create consumer transport
  socket.on('createConsumerTransport', async (_, cb) => {
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    });
    transports[socket.id] = transports[socket.id] || {};
    transports[socket.id].consumer = transport;
    cb({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  });
  socket.on('connectConsumerTransport', async ({ dtlsParameters }, cb) => {
    await transports[socket.id].consumer.connect({ dtlsParameters });
    cb();
  });

  // 5) consume on newProducer
  socket.on('consume', async ({ producerId, rtpCapabilities }, cb) => {
    if (!router.canConsume({ producerId, rtpCapabilities }))
      return cb({ error: 'cannotConsume' });
    const consumer = await transports[socket.id].consumer.consume({
      producerId,
      rtpCapabilities,
      paused: false
    });
    cb({
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    });
  });

  // 6) resume consumer
  socket.on('resumeConsumer', async ({ consumerId }, cb) => {
    await transports[socket.id].consumer.resume();
    cb();
  });

  // cleanup
  socket.on('disconnect', () => {
    const t = transports[socket.id] || {};
    t.producer?.close();
    t.consumer?.close();
    delete transports[socket.id];
  });
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));