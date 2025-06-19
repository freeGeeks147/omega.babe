import io from '/socket.io/socket.io.js';
import * as mediasoupClient from 'https://unpkg.com/mediasoup-client@3/lib/index.js';

const socket = io();
let device, producerTransport, consumerTransport;
let localStream;
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

document.getElementById('start').onclick = start;

async function start() {
  console.log('Requesting local media...');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    localVideo.srcObject = localStream;
    console.log('Local media obtained');
  } catch (err) {
    console.error('Failed to get local media:', err);
    return;
  }
  console.log('Joining room...');
  socket.emit('join');
}

socket.on('waiting', () => console.log('Waiting for a peer...'));

socket.on('roomReady', async ({ roomId }) => {
  console.log('Room ready:', roomId);

  // 1. Get router RTP capabilities
  const rtpCapabilities = await new Promise(res => socket.emit('getRtpCapabilities', null, res));

  // 2. Create device
  device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });

  // 3. Setup consumer transport
  const recvParams = await new Promise(res => socket.emit('createTransport', { roomId }, res));
  consumerTransport = device.createRecvTransport(recvParams);
  consumerTransport.on('connect', ({ dtlsParameters }, cb) => {
    console.log('Consumer DTLS connect');
    socket.emit('connectTransport', { roomId, dtlsParameters }, cb);
  });

  socket.on('newProducer', async ({ producerId }) => {
    console.log('New producer:', producerId);
    const params = await new Promise(res => socket.emit('consume', { roomId, producerId, rtpCapabilities: device.rtpCapabilities }, res));
    if (params.error) {
      console.warn('Cannot consume:', params.error);
      return;
    }
    const consumer = await consumerTransport.consume(params);
    const remoteStream = new MediaStream();
    remoteStream.addTrack(consumer.track);
    remoteVideo.srcObject = remoteStream;
    console.log('Remote stream rendered');
  });

  // 4. Setup producer transport
  const sendParams = await new Promise(res => socket.emit('createTransport', { roomId }, res));
  producerTransport = device.createSendTransport(sendParams);
  producerTransport.on('connect', ({ dtlsParameters }, cb) => {
    console.log('Producer DTLS connect');
    socket.emit('connectTransport', { roomId, dtlsParameters }, cb);
  });
  producerTransport.on('produce', ({ kind, rtpParameters }, cb) => {
    console.log('Producing track:', kind);
    socket.emit('produce', { roomId, kind, rtpParameters }, cb);
  });

  // 5. Produce tracks from localStream
  localStream.getTracks().forEach(track => {
    console.log('Producing track:', track.kind);
    producerTransport.produce({ track });
  });
});