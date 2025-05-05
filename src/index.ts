import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { initializeDatabase } from './models/database';

dotenv.config();

async function startServer() {
    const db = await initializeDatabase('restaurant.db');
    const app = express();
    const httpServer = createServer(app);
    
    const io = new Server(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL,
        methods: ['GET', 'POST']
      }
    });
    
    const PORT = process.env.PORT || 4000;
    
    app.get('/', (req, res) => {
      res.send('Restaurant Backend Running');
    });
    
    io.on('connection', (socket) => {
      console.log('A client connected:', socket.id);
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
