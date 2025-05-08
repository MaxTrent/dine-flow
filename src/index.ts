import express, { Application } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createServer, Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import dotenv from 'dotenv';
import winston from 'winston';
import promClient from 'prom-client';
import { initializeDatabase, Database } from './models/database';
import { ChatBotService } from './services/chatbot';

dotenv.config();

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/app.log' }),
    new winston.transports.Console()
  ],
});

// Configure Prometheus metrics
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });
const httpRequestCounter = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});
const websocketConnections = new promClient.Gauge({
  name: 'websocket_connections_active',
  help: 'Number of active WebSocket connections',
  registers: [register],
});

interface CustomSocket extends Socket {
  deviceId?: string;
  sessionData?: {
    state: string;
    selectedItemId?: number;
    lastInputTime: number;
  };
}

interface ServerInstance {
  app: Application;
  server: HTTPServer;
  io: Server;
}

async function startServer(): Promise<ServerInstance> {
  logger.info('Starting server', {
    env: {
      PORT: process.env.PORT,
      FRONTEND_URL: process.env.FRONTEND_URL,
      JWT_SECRET: process.env.JWT_SECRET ? '[REDACTED]' : undefined,
    },
  });

  const db: Database = await initializeDatabase('restaurant.db');
  const app: Application = express();
  const server: HTTPServer = createServer(app);

  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
  });

  // Middleware to count HTTP requests
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      httpRequestCounter.inc({
        method: req.method,
        path: req.path,
        status: res.statusCode,
      });
      logger.info('HTTP request processed', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: duration,
      });
    });
    next();
  });

  app.get('/', (req, res) => {
    res.send('Restaurant Backend Running');
  });

  // Health endpoint
  app.get('/health', async (req, res) => {
    try {
      await db.get('SELECT 1');
      res.status(200).json({ status: 'healthy', database: 'connected' });
    } catch (err) {
      logger.error('Health check failed', { error: err });
      res.status(500).json({ status: 'unhealthy', database: 'disconnected' });
    }
  });

  // Metrics endpoint
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  const chatBot = new ChatBotService(db);

  io.on('connection', async (socket: CustomSocket) => {
    websocketConnections.inc();
    let deviceId = socket.handshake.query.deviceId as string;

    if (!deviceId) {
      deviceId = uuidv4();
    }
    socket.deviceId = deviceId;

    logger.info('Client connected', { socketId: socket.id, deviceId });

    try {
      await db.run(
        `INSERT OR REPLACE INTO Sessions (deviceId, currentOrder, createdAt) VALUES (?, ?, ?)`,
        [deviceId, JSON.stringify([]), new Date().toISOString()]
      );
    } catch (err) {
      logger.error('Error storing session', { error: err, deviceId });
      socket.emit('error', { text: 'Failed to initialize session.' });
      socket.disconnect();
      return;
    }

    chatBot.initializeSocket(socket as any);

    socket.on('message', (data) => {
      logger.info('Received message', { socketId: socket.id, deviceId, data });
    });

    socket.on('disconnect', () => {
      websocketConnections.dec();
      logger.info('Client disconnected', { socketId: socket.id, deviceId });
    });
  });

  return { app, server, io };
}

// Start the server and bind to PORT
startServer()
  .then(({ server }) => {
    const port = parseInt(process.env.PORT || '4000', 10);
    logger.info('Attempting to bind to port', { port });
    server.listen(port, '0.0.0.0', () => {
      logger.info('Server successfully listening', { port });
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      logger.error('Server error', { port, error: err });
      process.exit(1);
    });
  })
  .catch((err) => {
    logger.error('Failed to start server', { error: err });
    process.exit(1);
  });

export { startServer };