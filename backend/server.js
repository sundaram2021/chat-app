const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

app.use(cors());

const rooms = new Map(); // roomId -> { type: 'single'|'group', users: new Set<socketId>, messages: [] }

app.get('/', (req, res) => {
  res.send('Chat server is running');
});

app.get('/create-single', (req, res) => {
  const roomId = uuidv4();
  rooms.set(roomId, { type: 'single', users: new Set(), messages: [] });
  res.json({ roomId });
});

app.get('/create-group', (req, res) => {
  const roomId = uuidv4();
  rooms.set(roomId, { type: 'group', users: new Set(), messages: [] });
  res.json({ roomId });
});

app.get('/single-full/:roomId', (req, res) => {
    // if the people in single room is 2 return false else true
    const roomId = req.params.roomId;
    const room = rooms.get(roomId);
    if (room && room.type === 'single') {
        return res.json({ full: room.users.size >= 2 });
    }
    res.status(404).json({ error: 'Room not found or not a single chat' });
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join room', ({ roomId, userName }) => {
    if (!rooms.has(roomId)) {
      socket.emit('error', 'Room does not exist');
      console.log(`Join failed: Room ${roomId} does not exist`);
      return;
    }

    const room = rooms.get(roomId);
    if (room.type === 'single' && room.users.size >= 2) {
      socket.emit('error', 'Single chat is full');
      console.log(`Join failed: Single chat ${roomId} is full`);
      return;
    }

    // Only proceed if join is successful
    socket.join(roomId);
    room.users.add(socket.id);
    socket.userName = userName;
    socket.roomId = roomId;

    // Send history to new user
    socket.emit('chat history', room.messages);

    // Broadcast join to room (existing users including new one)
    io.to(roomId).emit('user joined', `${userName} has joined the chat`);
    console.log(`${userName} joined room ${roomId}`);
  });

  socket.on('chat message', (msg) => {
    if (!socket.roomId || !socket.userName) return;

    const room = rooms.get(socket.roomId);
    const fullMsg = { user: socket.userName, text: msg };
    room.messages.push(fullMsg);

    io.to(socket.roomId).emit('chat message', fullMsg);
  });

  socket.on('disconnect', () => {
    if (socket.roomId && socket.userName) { // Only if successfully joined
      const room = rooms.get(socket.roomId);
      room.users.delete(socket.id);
      io.to(socket.roomId).emit('user left', `${socket.userName} has left the chat`);
      console.log(`${socket.userName} left room ${socket.roomId}`);
    } else {
      console.log(`Disconnected without joining: ${socket.id}`);
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});