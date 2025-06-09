const { Device } = window.mediasoupClient;
const socket = io();
let device, producerTransport, consumerTransport;

(async () => {
  // 1) Fetch router RTP capabilities & load mediasoup device
  const rtpCaps = await new Promise(res =>
    socket.emit('getRouterRtpCapabilities', null, res)
  );
  device = new Device();
  await device.load({ routerRtpCapabilities: rtpCaps });

  // 2) Create & connect producer transport
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

  // 3) Prompt for camera & mic
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: 25 },
      audio: true
    });
  } catch (err) {
    document.getElementById('status').innerText = 'Camera/mic access error';
    return;
  }
  document.getElementById('localVideo').srcObject = stream;

  // Mute toggle
  const muteBtn = document.getElementById('mute-btn');
  let micOn = true;
  muteBtn.addEventListener('click', () => {
    micOn = !micOn;
    stream.getAudioTracks().forEach(t => (t.enabled = micOn));
    muteBtn.textContent = micOn ? '🎙️' : '🔇';
  });

  // 4) Produce each track to SFU
  for (const track of stream.getTracks()) {
    await producerTransport.produce({ track });
  }

  // 5) Create & connect consumer transport then handle incoming media
  const cParams = await new Promise(res =>
    socket.emit('createConsumerTransport', null, res)
  );
  consumerTransport = device.createRecvTransport(cParams);
  consumerTransport.on('connect', ({ dtlsParameters }, cb) =>
    socket.emit('connectConsumerTransport', { dtlsParameters }, cb)
  );
  socket.on('newProducer', async ({ producerId }) => {
    // Hide status once partner video arrives
    document.getElementById('status').style.display = 'none';
    const consParams = await new Promise(res =>
      socket.emit('consume', { producerId, rtpCapabilities: device.rtpCapabilities }, res)
    );
    const consumer = await consumerTransport.consume(consParams);
    document.getElementById('remoteVideo').srcObject = new MediaStream([
      consumer.track
    ]);
    socket.emit('resumeConsumer', { consumerId: consumer.id }, () => {});
  });

  // 6) Chat UI elements
  const statusEl   = document.getElementById('status');
  const messagesEl = document.getElementById('messages');
  const inputEl    = document.getElementById('input');
  const sendBtn    = document.getElementById('send-btn');
  const nextBtn    = document.getElementById('next-btn');

  // Helper to append chat bubbles
  function append(who, text) {
    const d = document.createElement('div');
    d.className = 'message ' + (who === 'You' ? 'self' : 'other');
    d.innerText = text;
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Input handlers
  inputEl.addEventListener('input', () => {
    sendBtn.disabled = !inputEl.value.trim();
  });
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendBtn.click();
    }
  });
  sendBtn.addEventListener('click', () => {
    const txt = inputEl.value.trim();
    if (!txt) return;
    socket.emit('message', txt);
    append('You', txt);
    inputEl.value = '';
    sendBtn.disabled = true;
  });
  nextBtn.addEventListener('click', () => window.location.reload());

  // Chat message handlers
  socket.on('message', msg => append('Peer', msg));
  socket.on('partner-disconnected', () => window.location.reload());
})();