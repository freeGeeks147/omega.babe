const socket = io();
let device, producerTransport, consumerTransport, producer, consumer;
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

async function start() {
  socket.emit('join');
}

document.getElementById('start').onclick = start;

socket.on('waiting', () => console.log('Waiting for a peer...'));

socket.on('roomReady', async ({ roomId }) => {
  // get RTP Capabilities
  const rtpCapabilities = await new Promise(resolve => {
    socket.emit('getRtpCapabilities', null, resolve);
  });

  // init device
  device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });

  // create send transport
  const sendParams = await new Promise(resolve => {
    socket.emit('createTransport', { roomId }, resolve);
  });
  producerTransport = device.createSendTransport(sendParams);

  producerTransport.on('connect', ({ dtlsParameters }, callback) => {
    socket.emit('connectTransport', { dtlsParameters, roomId }, callback);
  });

  producerTransport.on('produce', ({ kind, rtpParameters }, callback) => {
    socket.emit('produce', { kind, rtpParameters, roomId }, ({ id }) => callback({ id }));
  });

  // get user media and produce
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  localVideo.srcObject = stream;
  stream.getTracks().forEach(track => producerTransport.produce({ track }));

  // create receive transport
  const recvParams = await new Promise(resolve => {
    socket.emit('createTransport', { roomId }, resolve);
  });
  consumerTransport = device.createRecvTransport(recvParams);

  consumerTransport.on('connect', ({ dtlsParameters }, callback) => {
    socket.emit('connectTransport', { dtlsParameters, roomId }, callback);
  });

  // consume existing producers
  const producers = []; // you may broadcast producer list
  producers.forEach(async pId => {
    const consumeParams = await new Promise(resolve => {
      socket.emit('consume', { producerId: pId, rtpCapabilities: device.rtpCapabilities, roomId }, resolve);
    });
    consumer = await consumerTransport.consume(consumeParams);
    const remoteStream = new MediaStream();
    remoteStream.addTrack(consumer.track);
    remoteVideo.srcObject = remoteStream;
  });
});
