import { ChatBotService } from '../services/chatbot';
import { Database } from '../models/database';
import { Server } from 'http';
import { CustomSocket } from '../types/socket';

interface MockCustomSocket extends CustomSocket {
  emit: jest.Mock<boolean, [string, ...unknown[]]>;
  on: jest.Mock<this, [string, (...args: unknown[]) => void]>;
  disconnect: jest.Mock<this, []>;
}

interface MockDatabase extends Database {
  get: jest.Mock<Promise<unknown>, [string, ...unknown[]]>;
  run: jest.Mock<Promise<void>, [string, ...unknown[]]>;
  all: jest.Mock<Promise<unknown[]>, [string, ...unknown[]]>;
}

describe('ChatBotService', () => {
  let chatBot: ChatBotService;
  let mockSocket: MockCustomSocket;
  let mockDb: MockDatabase;
  let server: Server;

  beforeAll(() => {
    mockDb = {
      get: jest.fn(),
      run: jest.fn(),
      all: jest.fn(),
    } as MockDatabase;

    chatBot = new ChatBotService(mockDb);

    mockSocket = {
      emit: jest.fn().mockReturnValue(true),
      on: jest.fn().mockReturnValue(undefined),
      disconnect: jest.fn().mockReturnValue(undefined),
      deviceId: 'test-device',
      sessionData: {
        state: 'main_menu',
        lastInputTime: 0,
      },
    } as MockCustomSocket;

    server = new Server();
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSocket.sessionData = {
      state: 'main_menu',
      lastInputTime: 0,
    };
  });

  test('should send welcome message on initialization', () => {
    chatBot.initializeSocket(mockSocket);

    expect(mockSocket.emit).toHaveBeenCalledWith('message', {
      text: expect.stringContaining('Welcome to the Restaurant ChatBot!'),
      deviceId: 'test-device',
    });
    expect(mockSocket.on).toHaveBeenCalledWith('message', expect.any(Function));
  });

  test('should handle invalid deviceId in message', () => {
    chatBot.initializeSocket(mockSocket);

    const messageHandler = mockSocket.on.mock.calls[0][1];
    messageHandler({ text: '1', deviceId: 'wrong-device' });

    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      text: 'Invalid or missing deviceId in message.',
      deviceId: 'test-device',
    });
  });

  test('should handle invalid input in main_menu state', async () => {
    mockDb.get.mockResolvedValue({ deviceId: 'test-device' });
    chatBot.initializeSocket(mockSocket);

    const messageHandler = mockSocket.on.mock.calls[0][1];
    await messageHandler({ text: 'invalid', deviceId: 'test-device' });

    expect(mockSocket.emit).toHaveBeenCalledWith('message', {
      text: expect.stringContaining('Invalid input: \'invalid\' is not a number'),
      deviceId: 'test-device',
    });
  });

  test('should transition to item_selection state on input 1', async () => {
    mockDb.get.mockResolvedValue({ deviceId: 'test-device' });
    chatBot.initializeSocket(mockSocket);

    const messageHandler = mockSocket.on.mock.calls[0][1];
    await messageHandler({ text: '1', deviceId: 'test-device' });

    expect(mockSocket.sessionData.state).toBe('item_selection');
    expect(mockSocket.emit).toHaveBeenCalledWith('message', {
      text: expect.stringContaining('Please select an item from the menu:'),
      deviceId: 'test-device',
    });
  });

  test('should handle item selection and transition to sub_menu', async () => {
    mockDb.get.mockResolvedValue({ deviceId: 'test-device' });
    mockSocket.sessionData.state = 'item_selection';
    chatBot.initializeSocket(mockSocket);

    const messageHandler = mockSocket.on.mock.calls[0][1];
    await messageHandler({ text: '1', deviceId: 'test-device' });

    expect(mockSocket.sessionData.state).toBe('sub_menu');
    expect(mockSocket.sessionData.selectedItemId).toBe(1);
    expect(mockSocket.emit).toHaveBeenCalledWith('message', {
      text: expect.stringContaining('Select an option for Pizza:'),
      deviceId: 'test-device',
    });
  });

  test('should add item to order and return to main_menu', async () => {
    mockDb.get.mockResolvedValue({ deviceId: 'test-device', currentOrder: '[]' });
    mockDb.run.mockResolvedValue(undefined);
    mockSocket.sessionData.state = 'item_selection';
    chatBot.initializeSocket(mockSocket);

    const messageHandler = mockSocket.on.mock.calls[0][1];
    await messageHandler({ text: '2', deviceId: 'test-device' });

    expect(mockDb.run).toHaveBeenCalledWith(
      'UPDATE Sessions SET currentOrder = ? WHERE deviceId = ?',
      [expect.any(String), 'test-device']
    );
    expect(mockSocket.sessionData.state).toBe('main_menu');
    expect(mockSocket.emit).toHaveBeenCalledWith('message', {
      text: expect.stringContaining('Added Burger to your order.'),
      deviceId: 'test-device',
    });
  });

  test('should handle checkout with empty order', async () => {
    mockDb.get.mockResolvedValue({ deviceId: 'test-device', currentOrder: '[]' });
    chatBot.initializeSocket(mockSocket);

    const messageHandler = mockSocket.on.mock.calls[0][1];
    await messageHandler({ text: '99', deviceId: 'test-device' });

    expect(mockSocket.emit).toHaveBeenCalledWith('message', {
      text: 'No order to place.',
      deviceId: 'test-device',
    });
    expect(mockSocket.sessionData.state).toBe('main_menu');
  });
});