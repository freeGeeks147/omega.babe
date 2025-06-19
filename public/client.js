import { io } from 'https://cdn.socket.io/4.7.2/socket.io.esm.min.js';
import { Device } from 'https://unpkg.com/mediasoup-client@3/lib-esm/index.js?module';

console.log('client.js loaded');
const socket = io();
socket.on('connect', () => console.log('[Socket] connected:', socket.id));
socket.on('disconnect', reason => console.log('[Socket] disconnected:', reason));
socket.on('connect_error', err => console.error('[Socket] connect_error:', err));

let device, sendTransport, recvTransport;
let localStream;
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

// Click handler
const startBtn = document.getElementById('start');
startBtn.addEventListener('click', async () => {
  console.log('[Button] Start clicked');
  console.log('Requesting media...');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    console.log('getUserMedia success:', localStream);
    localVideo.srcObject = localStream;
  } catch (err) {
    console.error('getUserMedia error:', err);
    return;
  }
  console.log('Emitting join');
  socket.emit('join');
});

// Signaling state
socket.on('waiting', () => console.log('[Server] waiting for peer'));  
socket.on('roomReady', async ({ roomId }) => {
  console.log('[Server] roomReady, room:', roomId);
  // 1. Get router RTP capabilities
  console.log('[Signal] requesting RTP capabilities');
  const rtpCapabilities = await new Promise(res => socket.emit('getRtpCapabilities', null, res));
  console.log('[Signal] rtpCapabilities received:', rtpCapabilities);

  // 2. Create device
  device = new Device();
  console.log('Loading device with router capabilities');
  await device.load({ routerRtpCapabilities: rtpCapabilities });
  console.log('Device loaded');

  // 3. Setup receive transport
  console.log('[Signal] creating receive transport');
  const recvParams = await new Promise(res => socket.emit('createTransport', { roomId }, res));
  console.log('[Signal] recvParams:', recvParams);
  recvTransport = device.createRecvTransport(recvParams);
  recvTransport.on('connect', ({ dtlsParameters }, cb) => {
    console.log('[RecvTransport] connecting...', dtlsParameters);
    socket.emit('connectTransport', { roomId, dtlsParameters }, cb);
  });
  socket.on('newProducer', async ({ producerId }) => {
    console.log('[Signal] newProducer:', producerId);
    const params = await new Promise(res => socket.emit('consume', { roomId, producerId, rtpCapabilities: device.rtpCapabilities }, res));
    console.log('[Signal] consume params:', params);
    if (params.error) {
      console.warn('Cannot consume:', params.error);
      return;
    }
    const consumer = await recvTransport.consume(params);
    console.log('[RecvTransport] consumer created:', consumer);
    const stream = new MediaStream();
    stream.addTrack(consumer.track);
    remoteVideo.srcObject = stream;
    console.log('[Video] remoteVideo.srcObject set');
  });

  // 4. Setup send transport & produce
  console.log('[Signal] creating send transport');
  const sendParams = await new Promise(res => socket.emit('createTransport', { roomId }, res));
  console.log('[Signal] sendParams:', sendParams);
  sendTransport = device.createSendTransport(sendParams);
  sendTransport.on('connect', ({ dtlsParameters }, cb) => {
    console.log('[SendTransport] connecting...', dtlsParameters);
    socket.emit('connectTransport', { roomId, dtlsParameters }, cb);
  });
  sendTransport.on('produce', ({ kind, rtpParameters }, cb) => {
    console.log('[SendTransport] producing', kind, rtpParameters);
    socket.emit('produce', { roomId, kind, rtpParameters }, ({ id }) => {
      console.log('[Signal] produce response id:', id);
      cb({ id });
    });
  });

  // 5. Produce local tracks
  console.log('Producing local tracks');
  localStream.getTracks().forEach(track => {
    console.log('Producing track:', track.kind);
    sendTransport.produce({ track });
  });
});
