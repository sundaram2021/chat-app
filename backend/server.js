// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const REDIS_URL = process.env.REDIS_URL; // Upstash URL
if (!REDIS_URL) {
  console.error('ERROR: REDIS_URL is not set. Provide Upstash URL in env.');
  process.exit(1);
}

const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  methods: ['GET', 'POST'],
}));

app.use(express.json());

const server = http.createServer(app);

// ---------- Redis init & Socket.IO adapter setup ----------
const pubClient = createClient({ url: REDIS_URL });
const subClient = createClient({ url: REDIS_URL }); // separate client for subscriber

async function initRedisAndSocket() {
  await pubClient.connect();
  await subClient.connect();
  console.log('Connected to Redis (Upstash).');

  // Create Socket.IO server after Redis is connected so adapter can be set
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
  });

  // Attach Redis adapter (works across instances)
  io.adapter(createAdapter(pubClient, subClient));
  console.log('Socket.IO Redis adapter configured.');

  // Expose io for handlers below
  setupSocketHandlers(io);

  return io;
}

// ---------- Helper functions (Redis-backed rooms/messages) ----------
const ROOM_META_KEY = (roomId) => `room:${roomId}:meta`;         // hash: { type: 'single'|'group' }
const ROOM_MESSAGES_KEY = (roomId) => `room:${roomId}:messages`; // list: JSON strings

// Save room metadata in Redis
async function createRoomInRedis(roomId, type) {
  await pubClient.hSet(ROOM_META_KEY(roomId), { type });
}

// Get room metadata from Redis
async function getRoomMeta(roomId) {
  const meta = await pubClient.hGetAll(ROOM_META_KEY(roomId));
  if (!meta || Object.keys(meta).length === 0) return null;
  return meta;
}

// Append message (caps stored messages to last 100)
async function pushMessageToRoom(roomId, messageObj) {
  const key = ROOM_MESSAGES_KEY(roomId);
  await pubClient.rPush(key, JSON.stringify(messageObj));
  await pubClient.lTrim(key, -100, -1);
}

// Get all messages (returns array of parsed messages)
async function getRoomMessages(roomId) {
  const key = ROOM_MESSAGES_KEY(roomId);
  const raw = await pubClient.lRange(key, 0, -1); // left->right stored in same order
  return raw.map((s) => {
    try { return JSON.parse(s); } catch (e) { return null; }
  }).filter(Boolean);
}

// ---------- HTTP endpoints ----------
app.get('/', (req, res) => {
  res.send('Chat server is running');
});

app.post('/create-single', async (req, res) => {
  try {
    const roomId = uuidv4();
    await createRoomInRedis(roomId, 'single');
    return res.json({ roomId });
  } catch (err) {
    console.error('create-single error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/create-group', async (req, res) => {
  try {
    const roomId = uuidv4();
    await createRoomInRedis(roomId, 'group');
    return res.json({ roomId });
  } catch (err) {
    console.error('create-group error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Check if single room is full (>=2 participants). Uses io.in(...).allSockets() so it's accurate across instances.
app.get('/single-full/:roomId', async (req, res) => {
  const roomId = req.params.roomId;
  try {
    const meta = await getRoomMeta(roomId);
    if (!meta || meta.type !== 'single') {
      return res.status(404).json({ error: 'Room not found or not a single chat' });
    }
    const sockets = await global.ioRef.in(roomId).allSockets();
    const count = sockets.size;
    return res.json({ full: count >= 2, count });
  } catch (err) {
    console.error('single-full error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

function setupSocketHandlers(io) {
  global.ioRef = io;

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join room', async ({ roomId, userName }) => {
      try {
        const meta = await getRoomMeta(roomId);
        if (!meta) {
          socket.emit('error', 'Room does not exist');
          console.log(`Join failed: Room ${roomId} does not exist`);
          return;
        }

        if (meta.type === 'single') {
          const sockets = await io.in(roomId).allSockets();
          if (sockets.size >= 2) {
            socket.emit('error', 'Single chat is full');
            console.log(`Join failed: Single chat ${roomId} is full`);
            return;
          }
        }

        // join room
        await socket.join(roomId);
        socket.userName = userName;
        socket.roomId = roomId;

        // fetch history from Redis and send
        const history = await getRoomMessages(roomId);
        socket.emit('chat history', history);

        // announce to everyone in room
        io.to(roomId).emit('user joined', `${userName} has joined the chat`);
        console.log(`${userName} joined room ${roomId}`);
      } catch (err) {
        console.error('join room error:', err);
        socket.emit('error', 'Internal server error');
      }
    });

    socket.on('chat message', async (msg) => {
      try {
        if (!socket.roomId || !socket.userName) return;

        const fullMsg = {
          user: socket.userName,
          text: msg,
          ts: Date.now(),
        };

        // persist to Redis and broadcast
        await pushMessageToRoom(socket.roomId, fullMsg);
        io.to(socket.roomId).emit('chat message', fullMsg);
      } catch (err) {
        console.error('chat message error:', err);
        socket.emit('error', 'Failed to send message');
      }
    });

    socket.on('disconnect', async () => {
      try {
        if (socket.roomId && socket.userName) {
          const roomId = socket.roomId;
          io.to(roomId).emit('user left', `${socket.userName} has left the chat`);
          console.log(`${socket.userName} left room ${roomId}`);
        } else {
          console.log(`Disconnected without joining: ${socket.id}`);
        }
        console.log('User disconnected:', socket.id);
      } catch (err) {
        console.error('disconnect handler error:', err);
      }
    });
  });
}

// ---------- Start ----------
const PORT = process.env.PORT || 5000;

initRedisAndSocket()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize server:', err);
    process.exit(1);
  });

// ---------- Graceful shutdown ----------
async function shutdown() {
  console.log('Shutting down...');
  try {
    await pubClient.quit();
    await subClient.quit();
  } catch (e) {
    console.warn('Error while closing redis:', e);
  }
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
