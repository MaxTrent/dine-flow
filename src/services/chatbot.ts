import { Socket } from 'socket.io';
import { Database } from '../models/database';
import winston from 'winston';
import { getFormattedMenu, getFormattedSubMenu, getMenuItem, getMenuOption, MenuItem, OrderItem } from '../models/menu';

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/app.log' })
  ]
});

// User state enum
enum UserState {
  MAIN_MENU = 'main_menu',
  ITEM_SELECTION = 'item_selection',
  SUB_MENU = 'sub_menu'
}

// Interface for session data
interface SessionData {
  state: UserState;
  selectedItemId?: number;
  lastInputTime: number; // For debouncing
}

// Interface for custom socket
interface CustomSocket extends Socket {
  deviceId: string;
  sessionData: SessionData;
}

// Input validation result
interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

export class ChatBotService {
  private db: Database;
  private readonly DEBOUNCE_MS = 500; // Debounce interval in milliseconds

  constructor(db: Database) {
    this.db = db;
  }

  // Initialize socket handlers
  initializeSocket(socket: CustomSocket) {
    socket.sessionData = { state: UserState.MAIN_MENU, lastInputTime: 0 };
    this.sendWelcomeMessage(socket);

    socket.on('message', (data: { text: string; deviceId?: string }) => {
      // Validate deviceId in message
      if (!data.deviceId || data.deviceId !== socket.deviceId) {
        socket.emit('error', { text: 'Invalid or missing deviceId in message.', deviceId: socket.deviceId });
        logger.error({ deviceId: socket.deviceId, message: 'Invalid deviceId in message', receivedDeviceId: data.deviceId });
        return;
      }
      this.handleMessage(socket, data.text.trim());
    });
  }

  // Send welcome message with main menu
  private sendWelcomeMessage(socket: CustomSocket) {
    const message = `Welcome to the Restaurant ChatBot!\n${getFormattedMenu()}\n\n` +
                    `Select 1 to Place an order\n` +
                    `Select 99 to checkout order\n` +
                    `Select 98 to see order history\n` +
                    `Select 97 to see current order\n` +
                    `Select 0 to cancel order`;
    socket.emit('message', { text: message, deviceId: socket.deviceId });
    logger.info({ deviceId: socket.deviceId, message: 'Sent welcome message', response: message });
  }

  // Validate input based on context
  private validateInput(input: string, validOptions: number[], context: string): ValidationResult {
    // Check for non-numeric input
    if (!/^\d+$/.test(input)) {
      return { isValid: false, errorMessage: `Invalid input: "${input}" is not a number. Please select a valid option.` };
    }

    const num = parseInt(input);
    // Check if input is in valid options
    if (!validOptions.includes(num)) {
      return { isValid: false, errorMessage: `Invalid input: "${input}" is not a valid ${context}. Please select: ${validOptions.join(', ')}.` };
    }

    return { isValid: true };
  }

  // Check for rapid submissions
  private isDebounced(socket: CustomSocket): boolean {
    const now = Date.now();
    if (now - socket.sessionData.lastInputTime < this.DEBOUNCE_MS) {
      return true;
    }
    socket.sessionData.lastInputTime = now;
    return false;
  }

  // Handle incoming messages
  private async handleMessage(socket: CustomSocket, input: string) {
    logger.info({ deviceId: socket.deviceId, input });

    // Check for rapid submissions
    if (this.isDebounced(socket)) {
      socket.emit('message', { text: 'Please wait a moment before submitting again.', deviceId: socket.deviceId });
      logger.info({ deviceId: socket.deviceId, message: 'Input debounced' });
      return;
    }

    // Verify session exists
    const session = await this.db.get(`SELECT deviceId FROM Sessions WHERE deviceId = ?`, [socket.deviceId]);
    if (!session) {
      socket.emit('error', { text: 'Session not found. Please reconnect.', deviceId: socket.deviceId });
      logger.error({ deviceId: socket.deviceId, message: 'Session not found' });
      socket.disconnect();
      return;
    }

    const state = socket.sessionData.state;
    const validMainOptions = [1, 99, 98, 97, 0];
    const validMenuIds = getFormattedMenu()
      .split('\n')
      .map(line => parseInt(line.split(':')[0]))
      .filter(n => !isNaN(n));

    if (state === UserState.MAIN_MENU) {
      const validation = this.validateInput(input, validMainOptions, 'menu option');
      if (!validation.isValid) {
        this.sendInvalidInput(socket, validation.errorMessage!);
        return;
      }

      switch (input) {
        case '1':
          socket.sessionData.state = UserState.ITEM_SELECTION;
          socket.emit('message', { text: `Please select an item from the menu:\n${getFormattedMenu()}`, deviceId: socket.deviceId });
          logger.info({ deviceId: socket.deviceId, message: 'Prompted for item selection' });
          break;
        case '99':
          await this.handleCheckout(socket);
          break;
        case '98':
          await this.handleOrderHistory(socket);
          break;
        case '97':
          await this.handleCurrentOrder(socket);
          break;
        case '0':
          await this.handleCancelOrder(socket);
          break;
      }
    } else if (state === UserState.ITEM_SELECTION) {
      const validation = this.validateInput(input, validMenuIds, 'menu item');
      if (!validation.isValid) {
        this.sendInvalidInput(socket, validation.errorMessage!);
        return;
      }

      const itemId = parseInt(input);
      const item = getMenuItem(itemId);
      if (!item) {
        this.sendInvalidInput(socket, `Invalid item ID: ${itemId}. Please select a valid menu item.`);
        return;
      }

      if (item.options) {
        socket.sessionData.state = UserState.SUB_MENU;
        socket.sessionData.selectedItemId = itemId;
        const subMenu = getFormattedSubMenu(itemId);
        socket.emit('message', { text: `Select an option for ${item.name}:\n${subMenu}`, deviceId: socket.deviceId });
        logger.info({ deviceId: socket.deviceId, message: `Prompted for sub-menu for item ${itemId}` });
      } else {
        await this.addItemToOrder(socket, item);
        socket.sessionData.state = UserState.MAIN_MENU;
        this.sendWelcomeMessage(socket);
      }
    } else if (state === UserState.SUB_MENU) {
      const itemId = socket.sessionData.selectedItemId;
      if (!itemId) {
        this.sendInvalidInput(socket, 'No item selected. Please start over.');
        return;
      }

      const item = getMenuItem(itemId);
      if (!item || !item.options) {
        this.sendInvalidInput(socket, 'Invalid item or no options available. Please start over.');
        return;
      }

      const validOptionIds = item.options.map(opt => opt.id);
      const validation = this.validateInput(input, validOptionIds, 'sub-menu option');
      if (!validation.isValid) {
        this.sendInvalidInput(socket, validation.errorMessage!);
        return;
      }

      const optionId = parseInt(input);
      const option = getMenuOption(itemId, optionId);
      if (!option) {
        this.sendInvalidInput(socket, `Invalid option ID: ${optionId}. Please select a valid option.`);
        return;
      }

      await this.addItemToOrder(socket, { ...item, price: option.price, name: `${item.name} (${option.name})` });
      socket.sessionData.state = UserState.MAIN_MENU;
      this.sendWelcomeMessage(socket);
    }
  }

  // Send invalid input message and repeat current menu
  private sendInvalidInput(socket: CustomSocket, message: string) {
    let repeatMenu = '';
    if (socket.sessionData.state === UserState.MAIN_MENU) {
      repeatMenu = `Welcome to the Restaurant ChatBot!\n${getFormattedMenu()}\n\n` +
                   `Select 1 to Place an order\n` +
                   `Select 99 to checkout order\n` +
                   `Select 98 to see order history\n` +
                   `Select 97 to see current order\n` +
                   `Select 0 to cancel order`;
    } else if (socket.sessionData.state === UserState.ITEM_SELECTION) {
      repeatMenu = `Please select an item from the menu:\n${getFormattedMenu()}`;
    } else if (socket.sessionData.state === UserState.SUB_MENU && socket.sessionData.selectedItemId) {
      const item = getMenuItem(socket.sessionData.selectedItemId);
      const subMenu = getFormattedSubMenu(socket.sessionData.selectedItemId);
      repeatMenu = `Select an option for ${item?.name}:\n${subMenu}`;
    }

    socket.emit('message', { text: `${message}\n\n${repeatMenu}`, deviceId: socket.deviceId });
    logger.info({ deviceId: socket.deviceId, message: 'Sent invalid input response', response: message });
  }

  // Add item to current order
  private async addItemToOrder(socket: CustomSocket, item: MenuItem) {
    try {
      const session = await this.db.get(`SELECT currentOrder FROM Sessions WHERE deviceId = ?`, [socket.deviceId]);
      let currentOrder: OrderItem[] = session.currentOrder ? JSON.parse(session.currentOrder) : [];

      const existingItem = currentOrder.find(i => i.itemId === item.id && i.name === item.name);
      if (existingItem) {
        existingItem.quantity += 1;
      } else {
        currentOrder.push({
          itemId: item.id,
          name: item.name,
          price: item.price,
          quantity: 1
        });
      }

      await this.db.run(
        `UPDATE Sessions SET currentOrder = ? WHERE deviceId = ?`,
        [JSON.stringify(currentOrder), socket.deviceId]
      );

      socket.emit('message', { text: `Added ${item.name} to your order.`, deviceId: socket.deviceId });
      logger.info({ deviceId: socket.deviceId, message: `Added item ${item.name} to order`, order: currentOrder });
    } catch (err) {
      logger.error({ deviceId: socket.deviceId, message: 'Error adding item to order', error: err });
      socket.emit('message', { text: 'Error adding item to order.', deviceId: socket.deviceId });
    }
  }

  // Handle checkout
  private async handleCheckout(socket: CustomSocket) {
    try {
      const session = await this.db.get(`SELECT currentOrder FROM Sessions WHERE deviceId = ?`, [socket.deviceId]);
      const currentOrder: OrderItem[] = session.currentOrder ? JSON.parse(session.currentOrder) : [];

      if (currentOrder.length === 0) {
        socket.emit('message', { text: 'No order to place.', deviceId: socket.deviceId });
        logger.info({ deviceId: socket.deviceId, message: 'No order to checkout' });
      } else {
        await this.db.run(
          `INSERT INTO Orders (deviceId, items, status, createdAt) VALUES (?, ?, ?, ?)`,
          [socket.deviceId, JSON.stringify(currentOrder), 'placed', new Date().toISOString()]
        );

        await this.db.run(
          `UPDATE Sessions SET currentOrder = ? WHERE deviceId = ?`,
          [JSON.stringify([]), socket.deviceId]
        );

        socket.emit('message', { text: 'Order placed successfully!', deviceId: socket.deviceId });
        logger.info({ deviceId: socket.deviceId, message: 'Order placed', order: currentOrder });
      }

      socket.sessionData.state = UserState.MAIN_MENU;
      this.sendWelcomeMessage(socket);
    } catch (err) {
      logger.error({ deviceId: socket.deviceId, message: 'Error during checkout', error: err });
      socket.emit('message', { text: 'Error placing order.', deviceId: socket.deviceId });
    }
  }

  // Handle order history
  private async handleOrderHistory(socket: CustomSocket) {
    try {
      const orders = await this.db.all(
        `SELECT id, items, createdAt FROM Orders WHERE deviceId = ? AND status = 'placed'`,
        [socket.deviceId]
      );

      if (orders.length === 0) {
        socket.emit('message', { text: 'No orders found.', deviceId: socket.deviceId });
        logger.info({ deviceId: socket.deviceId, message: 'No order history found' });
      } else {
        const formattedOrders = orders.map(order => {
          const items: OrderItem[] = JSON.parse(order.items);
          const itemList = items.map(item => `${item.quantity}x ${item.name} ($${item.price})`).join(', ');
          return `Order #${order.id}: ${itemList} on ${new Date(order.createdAt).toLocaleString()}`;
        }).join('\n');
        socket.emit('message', { text: `Order History:\n${formattedOrders}`, deviceId: socket.deviceId });
        logger.info({ deviceId: socket.deviceId, message: 'Sent order history', orders: formattedOrders });
      }

      socket.sessionData.state = UserState.MAIN_MENU;
      this.sendWelcomeMessage(socket);
    } catch (err) {
      logger.error({ deviceId: socket.deviceId, message: 'Error fetching order history', error: err });
      socket.emit('message', { text: 'Error fetching order history.', deviceId: socket.deviceId });
    }
  }

  // Handle current order
  private async handleCurrentOrder(socket: CustomSocket) {
    try {
      const session = await this.db.get(`SELECT currentOrder FROM Sessions WHERE deviceId = ?`, [socket.deviceId]);
      const currentOrder: OrderItem[] = session.currentOrder ? JSON.parse(session.currentOrder) : [];

      if (currentOrder.length === 0) {
        socket.emit('message', { text: 'No current order.', deviceId: socket.deviceId });
        logger.info({ deviceId: socket.deviceId, message: 'No current order' });
      } else {
        const formattedOrder = currentOrder
          .map(item => `${item.quantity}x ${item.name} ($${item.price})`)
          .join('\n');
        socket.emit('message', { text: `Current order:\n${formattedOrder}`, deviceId: socket.deviceId });
        logger.info({ deviceId: socket.deviceId, message: 'Sent current order', order: formattedOrder });
      }

      socket.sessionData.state = UserState.MAIN_MENU;
      this.sendWelcomeMessage(socket);
    } catch (err) {
      logger.error({ deviceId: socket.deviceId, message: 'Error fetching current order', error: err });
      socket.emit('message', { text: 'Error fetching current order.', deviceId: socket.deviceId });
    }
  }

  // Handle cancel order
  private async handleCancelOrder(socket: CustomSocket) {
    try {
      const session = await this.db.get(`SELECT currentOrder FROM Sessions WHERE deviceId = ?`, [socket.deviceId]);
      const currentOrder: OrderItem[] = session.currentOrder ? JSON.parse(session.currentOrder) : [];

      if (currentOrder.length === 0) {
        socket.emit('message', { text: 'No order to cancel.', deviceId: socket.deviceId });
        logger.info({ deviceId: socket.deviceId, message: 'No order to cancel' });
      } else {
        await this.db.run(
          `UPDATE Sessions SET currentOrder = ? WHERE deviceId = ?`,
          [JSON.stringify([]), socket.deviceId]
        );
        socket.emit('message', { text: 'Order cancelled.', deviceId: socket.deviceId });
        logger.info({ deviceId: socket.deviceId, message: 'Order cancelled' });
      }

      socket.sessionData.state = UserState.MAIN_MENU;
      this.sendWelcomeMessage(socket);
    } catch (err) {
      logger.error({ deviceId: socket.deviceId, message: 'Error cancelling order', error: err });
      socket.emit('message', { text: 'Error cancelling order.', deviceId: socket.deviceId });
    }
  }
}