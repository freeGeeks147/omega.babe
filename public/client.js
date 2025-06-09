const { Device } = window.mediasoupClient;
const socket = io();
let device, producerTransport, consumerTransport;

(async () => {
  // 1) get router capabilities
  const routerRtpCapabilities = await new Promise(res =>
    socket.emit('getRouterRtpCapabilities', null, res)
  );

  // 2) load device
  device = new Device();
  await device.load({ routerRtpCapabilities });

  // 3) create & connect producer transport
  const pParams = await new Promise(res =>
    socket.emit('createProducerTransport', null, res)
  );
  producerTransport = device.createSendTransport(pParams);
  producerTransport.on('connect', ({ dtlsParameters }, cb) =>
    socket.emit('connectProducerTransport', { dtlsParameters }, cb)
  );
  producerTransport.on('produce', ({ kind, rtpParameters }, cb) =>
    socket.emit('produce', { kind, rtpParameters }, ({ id }) => cb({ id }))
  );

  // 4) capture & send
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width:640, height:360, frameRate:15 }, audio:true });
  document.getElementById('localVideo').srcObject = stream;
  for (const track of stream.getTracks())
    await producerTransport.produce({ track });

  // 5) create & connect consumer transport
  const cParams = await new Promise(res =>
    socket.emit('createConsumerTransport', null, res)
  );
  consumerTransport = device.createRecvTransport(cParams);
  consumerTransport.on('connect', ({ dtlsParameters }, cb) =>
    socket.emit('connectConsumerTransport', { dtlsParameters }, cb)
  );

  // 6) handle new producers
  socket.on('newProducer', async ({ producerId }) => {
    const consParams = await new Promise(res =>
      socket.emit('consume', { producerId, rtpCapabilities: device.rtpCapabilities }, res)
    );
    const consumer = await consumerTransport.consume(consParams);
    document.getElementById('remoteVideo').srcObject = new MediaStream([consumer.track]);
    socket.emit('resumeConsumer', { consumerId: consumer.id }, () => {});
  });
})();