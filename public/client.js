import { io } from 'https://cdn.socket.io/4.7.2/socket.io.esm.min.js';
import { Device } from 'https://unpkg.com/mediasoup-client@3/lib-esm/index.js?module';

const socket = io();
let device, sendTransport, recvTransport;
let localStream;
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

// Click handler
document.getElementById('start').addEventListener('click', async () => {
  console.log('Requesting media...');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    localVideo.srcObject = localStream;
    console.log('Local media ready');
  } catch (err) {
    console.error('Media error:', err);
    return;
  }
  socket.emit('join');
});

socket.on('waiting', () => console.log('Waiting for peer...'));

socket.on('roomReady', async ({ roomId }) => {
  console.log('Paired, room:', roomId);
  const rtpCapabilities = await new Promise(res => socket.emit('getRtpCapabilities', null, res));

  device = new Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });

  // Setup receive transport
  const recvParams = await new Promise(res => socket.emit('createTransport', { roomId }, res));
  recvTransport = device.createRecvTransport(recvParams);
  recvTransport.on('connect', ({ dtlsParameters }, cb) => socket.emit('connectTransport', { roomId, dtlsParameters }, cb));
  socket.on('newProducer', async ({ producerId }) => {
    console.log('New producer:', producerId);
    const params = await new Promise(res => socket.emit('consume', { roomId, producerId, rtpCapabilities: device.rtpCapabilities }, res));
    if (params.error) return console.warn('Cannot consume');
    const consumer = await recvTransport.consume(params);
    const stream = new MediaStream();
    stream.addTrack(consumer.track);
    remoteVideo.srcObject = stream;
    console.log('Rendered remote');
  });

  // Setup send transport & produce
  const sendParams = await new Promise(res => socket.emit('createTransport', { roomId }, res));
  sendTransport = device.createSendTransport(sendParams);
  sendTransport.on('connect', ({ dtlsParameters }, cb) => socket.emit('connectTransport', { roomId, dtlsParameters }, cb));
  sendTransport.on('produce', ({ kind, rtpParameters }, cb) => socket.emit('produce', { roomId, kind, rtpParameters }, cb));

  localStream.getTracks().forEach(track => sendTransport.produce({ track }));
});