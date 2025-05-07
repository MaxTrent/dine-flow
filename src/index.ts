import express, { Application } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createServer, Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import dotenv from 'dotenv';
import { initializeDatabase } from './models/database';
import { ChatBotService } from './services/chatbot';
import { Database as SQLiteDatabase } from 'sqlite';

dotenv.config();

interface CustomSocket extends Socket {
  deviceId?: string;
}

interface ServerInstance {
  app: Application;
  server: HTTPServer;
  io: Server;
}

export async function startServer(): Promise<ServerInstance> {
  const db: SQLiteDatabase = await initializeDatabase('restaurant.db');
  const app: Application = express();
  const server: HTTPServer = createServer(app);

  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
  });

  app.get('/', (req, res) => {
    res.send('Restaurant Backend Running');
  });

  const chatBot = new ChatBotService(db);

  io.on('connection', async (socket: CustomSocket) => {
    let deviceId = socket.handshake.query.deviceId as string;

    if (!deviceId) {
      deviceId = uuidv4();
    }
    socket.deviceId = deviceId;

    console.log(`Client connected: ${socket.id} with deviceId: ${deviceId}`);

    try {
      await db.run(
        `INSERT OR REPLACE INTO Sessions (deviceId, currentOrder, createdAt) VALUES (?, ?, ?)`,
        [deviceId, JSON.stringify([]), new Date().toISOString()]
      );
    } catch (err) {
      console.error('Error storing session:', err);
      socket.emit('error', { text: 'Failed to initialize session.' });
      socket.disconnect();
      return;
    }

    chatBot.initializeSocket(socket as any);

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return { app, server, io };
}