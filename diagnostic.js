const io = require('socket.io-client');

const deviceId = 'test123';
const socket = io('http://localhost:4000', {
  query: { deviceId },
  transports: ['websocket'] // Force WebSocket
});

socket.on('connect', () => {
  console.log('Connected with deviceId:', deviceId);
});

socket.on('message', (data) => {
  console.log('Received:', JSON.stringify(data, null, 2));
});

socket.on('error', (err) => {
  console.error('Error:', err);
});

socket.on('connect_error', (err) => {
  console.error('Connection Error:', err.message);
});

socket.on('disconnect', () => {
  console.log('Disconnected');
});

// Send test messages after connection
setTimeout(() => {
  socket.emit('message', { text: '1', deviceId });
  setTimeout(() => {
    socket.emit('message', { text: 'abc', deviceId });
  }, 1000);
}, 1000);