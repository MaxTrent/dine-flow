import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { initDB } from './models/database';
import { menu } from './models/menu';


const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const app = express();
app.use(cors({ origin: FRONTEND_URL }));
const server = createServer(app);


const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST'],
  },
});

(async () => {
    const db = await initDB();
    console.log('Database initialized');

    io.on('connection', (socket) => {
        let deviceId = socket.handshake.query.deviceId as string;

        if (!deviceId) {
            deviceId = uuidv4();
        }

        await db.run(
            `INSERT OR REPLACE INTO Sessions (deviceId, currentOrder, createdAt) VALUES (?, ?, datetime('now'))`,
            [deviceId, JSON.stringify({ items: [] })]
        )

        socket.emit('message', async (msg) =>{
            const input = msg.toString().trim();
        
            switch (input){
                case '1':
                    socket.emit('message', {
                        text: menu.map(item => `${item.id}: ${item.name} - $${item.price || 'N/A'}`).join('\n'),
                    })
            }       
         })