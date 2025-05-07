import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import dotenv from 'dotenv';
import { initializeDatabase } from './models/database';
import { getFormattedMenu } from './models/menu';
import { ChatBotService } from './services/chatbot';

dotenv.config();

interface CustomSocket extends Socket {
    deviceId?: string;
  }

async function startServer() {
    const db = await initializeDatabase('restaurant.db');
    const app = express();
    const httpServer = createServer(app);
    
    const io = new Server(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
      transports: ['websocket'],
    });
    
    const PORT = process.env.PORT || 4000;
    
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
    
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });   
}

startServer().catch((err) => {
    console.error('Failed to start server:', err);
  });
