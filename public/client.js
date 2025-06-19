import io from '/socket.io/socket.io.js';
import * as mediasoupClient from 'https://unpkg.com/mediasoup-client@3/lib/index.js';

const socket = io();
let device, producerTransport, consumerTransport;
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

async function start() {
  socket.emit('join');
}

document.getElementById('start').onclick = start;

socket.on('waiting', () => console.log('Waiting for a peer...'));

socket.on('roomReady', async ({ roomId }) => {
  const rtpCapabilities = await new Promise(res => socket.emit('getRtpCapabilities', null, res));
  device = new mediasoupClient.Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });

  // produce transport
  const sendParams = await new Promise(res => socket.emit('createTransport', { roomId }, res));
  producerTransport = device.createSendTransport(sendParams);

  producerTransport.on('connect', ({ dtlsParameters }, cb) => socket.emit('connectTransport', { roomId, dtlsParameters }, cb));
  producerTransport.on('produce', ({ kind, rtpParameters }, cb) => socket.emit('produce', { roomId, kind, rtpParameters }, cb));

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  localVideo.srcObject = stream;
  stream.getTracks().forEach(track => producerTransport.produce({ track }));

  // consumer transport
  const recvParams = await new Promise(res => socket.emit('createTransport', { roomId }, res));
  consumerTransport = device.createRecvTransport(recvParams);
  consumerTransport.on('connect', ({ dtlsParameters }, cb) => socket.emit('connectTransport', { roomId, dtlsParameters }, cb));

  // when a new producer is announced
  socket.on('newProducer', async ({ producerId }) => {
    const params = await new Promise(res => socket.emit('consume', { roomId, producerId, rtpCapabilities: device.rtpCapabilities }, res));
    if (params.error) return;
    const consumer = await consumerTransport.consume(params);
    const remoteStream = new MediaStream(); remoteStream.addTrack(consumer.track);
    remoteVideo.srcObject = remoteStream;
  });
});
