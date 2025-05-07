import { Server, Socket } from 'socket.io';
import { createServer, Server as HTTPServer } from 'http';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { Application } from 'express';
import { Database as SQLiteDatabase } from 'sqlite';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { AddressInfo } from 'net';
import { startServer } from '../index';
import { initializeDatabase } from '../models/database';

// Utility to wait for Socket.IO messages
const waitForMessage = (socket: ClientSocket, event: string): Promise<any> => {
  return new Promise((resolve) => {
    socket.once(event, (data) => resolve(data));
  });
};

// Utility to query database
const queryDatabase = (db: SQLiteDatabase, sql: string): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    db.all(sql, [], (err: any, rows: any[] | PromiseLike<any[]>) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

describe('Chatbot Socket.IO Tests', () => {
  let server: HTTPServer;
  let io: Server;
  let app: Application;
  let clientSocket: ClientSocket;
  let db: SQLiteDatabase;
  let port: number;

  beforeAll(async () => {
    // Initialize in-memory database
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });
    console.log('Connected to in-memory database');
    await initializeDatabase(':memory:');
    console.log('Database initialized for tests');

    // Start server
    const serverInstance = await startServer();
    app = serverInstance.app;
    server = serverInstance.server;
    io = serverInstance.io;

    // Get dynamic port
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as AddressInfo).port;
        console.log(`Server started on port ${port}`);
        resolve();
      });
    });

    // Connect client
    clientSocket = Client(`http://localhost:${port}`, {
      query: { deviceId: 'test123' },
      transports: ['websocket'],
    });

    // Wait for client connection
    await new Promise<void>((resolve) => {
      clientSocket.on('connect', () => {
        console.log('Client connected');
        resolve();
      });
    });
  }, 10000);

  afterAll(async () => {
    // Close client
    if (clientSocket.connected) {
      clientSocket.close();
      console.log('Client socket closed');
    }

    // Close server
    io.close();
    await new Promise<void>((resolve) => {
      server.close(() => {
        console.log('Server closed');
        resolve();
      });
    });

    // Close database
    await db.close();
    console.log('Database closed');
  }, 10000);

  beforeEach(async () => {
    // Clear database tables
    await db.run('DELETE FROM Sessions');
    await db.run('DELETE FROM Orders');
    console.log('Database tables cleared');
  });

  test('should retrieve menu on connection', async () => {
    const message = await waitForMessage(clientSocket, 'message');
    expect(message.text).toMatch(/Welcome to the Restaurant ChatBot!/);
    expect(message.text).toMatch(/1: Pizza \(\$10\)/);
    expect(message.text).toMatch(/Select 1 to Place an order/);
  }, 10000);

  test('should create and checkout order', async () => {
    // Skip welcome message
    await waitForMessage(clientSocket, 'message');

    // Select order (1)
    clientSocket.emit('message', { text: '1', deviceId: 'test123' });
    let message = await waitForMessage(clientSocket, 'message');
    expect(message.text).toMatch(/Please select an item from the menu:/);
    expect(message.text).toMatch(/1: Pizza \(\$10\)/);

    // Select Pizza (1)
    clientSocket.emit('message', { text: '1', deviceId: 'test123' });
    message = await waitForMessage(clientSocket, 'message');
    expect(message.text).toMatch(/Select an option for Pizza:/);
    expect(message.text).toMatch(/1: Small \(\$10\)/);

    // Select Small (1)
    clientSocket.emit('message', { text: '1', deviceId: 'test123' });
    message = await waitForMessage(clientSocket, 'message');
    expect(message.text).toBe('Added Pizza (Small) to your order.');

    // Verify currentOrder in Sessions
    const sessions = await queryDatabase(db, "SELECT currentOrder FROM Sessions WHERE deviceId='test123'");
    expect(sessions.length).toBe(1);
    const currentOrder = JSON.parse(sessions[0].currentOrder);
    expect(currentOrder).toEqual([
      { itemId: 1, name: 'Pizza (Small)', price: 10, quantity: 1 },
    ]);

    // Checkout (99)
    clientSocket.emit('message', { text: '99', deviceId: 'test123' });
    message = await waitForMessage(clientSocket, 'message');
    expect(message.text).toBe('Order placed successfully!');

    // Verify Orders table
    const orders = await queryDatabase(db, "SELECT * FROM Orders WHERE deviceId='test123'");
    expect(orders.length).toBe(1);
    expect(orders[0].status).toBe('placed');
    expect(JSON.parse(orders[0].items)).toEqual([
      { itemId: 1, name: 'Pizza (Small)', price: 10, quantity: 1 },
    ]);

    // Verify currentOrder cleared
    const updatedSessions = await queryDatabase(db, "SELECT currentOrder FROM Sessions WHERE deviceId='test123'");
    expect(JSON.parse(updatedSessions[0].currentOrder)).toEqual([]);
  }, 15000);

  test('should retrieve order history and cancel order', async () => {
    // Skip welcome message
    await waitForMessage(clientSocket, 'message');

    // Create order
    clientSocket.emit('message', { text: '1', deviceId: 'test123' });
    await waitForMessage(clientSocket, 'message');
    clientSocket.emit('message', { text: '1', deviceId: 'test123' });
    await waitForMessage(clientSocket, 'message');
    clientSocket.emit('message', { text: '1', deviceId: 'test123' });
    await waitForMessage(clientSocket, 'message');

    // Checkout
    clientSocket.emit('message', { text: '99', deviceId: 'test123' });
    await waitForMessage(clientSocket, 'message');

    // Get history (98)
    clientSocket.emit('message', { text: '98', deviceId: 'test123' });
    let message = await waitForMessage(clientSocket, 'message');
    expect(message.text).toMatch(/Order History:/);
    expect(message.text).toMatch(/Order #1: 1x Pizza \(Small\) \(\$10\)/);

    // Add new item
    clientSocket.emit('message', { text: '1', deviceId: 'test123' });
    await waitForMessage(clientSocket, 'message');
    clientSocket.emit('message', { text: '1', deviceId: 'test123' });
    await waitForMessage(clientSocket, 'message');
    clientSocket.emit('message', { text: '1', deviceId: 'test123' });
    await waitForMessage(clientSocket, 'message');

    // Verify currentOrder
    let sessions = await queryDatabase(db, "SELECT currentOrder FROM Sessions WHERE deviceId='test123'");
    expect(JSON.parse(sessions[0].currentOrder)).toHaveLength(1);

    // Cancel order (0)
    clientSocket.emit('message', { text: '0', deviceId: 'test123' });
    message = await waitForMessage(clientSocket, 'message');
    expect(message.text).toBe('Order cancelled.');

    // Verify currentOrder cleared
    sessions = await queryDatabase(db, "SELECT currentOrder FROM Sessions WHERE deviceId='test123'");
    expect(JSON.parse(sessions[0].currentOrder)).toEqual([]);
  }, 15000);

  test('should handle invalid inputs', async () => {
    // Skip welcome message
    await waitForMessage(clientSocket, 'message');

    // Send non-numeric input
    clientSocket.emit('message', { text: 'abc', deviceId: 'test123' });
    let message = await waitForMessage(clientSocket, 'message');
    expect(message.text).toMatch(/Invalid input: "abc" is not a number/);
    expect(message.text).toMatch(/Welcome to the Restaurant ChatBot!/);

    // Send invalid option
    clientSocket.emit('message', { text: '100', deviceId: 'test123' });
    message = await waitForMessage(clientSocket, 'message');
    expect(message.text).toMatch(/Invalid input: "100" is not a valid menu option/);
    expect(message.text).toMatch(/Select: 1, 99, 98, 97, 0/);
    expect(message.text).toMatch(/Welcome to the Restaurant ChatBot!/);
  }, 10000);
});