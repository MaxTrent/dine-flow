import { Database } from 'sqlite';
import { OrderItem } from '../types/order';
import { menu, MenuItem } from '../models/menu';

export function formatMenuItems(): string {
  return 'Select an item:\n' + menu.map(i =>
    `${i.id}: ${i.name}${i.price ? ` ($${i.price})` : ''}`
  ).join('\n');
}

export function formatSubOptions(item: MenuItem): string {
  return `Select an option for ${item.name}:\n` + item.options!.map(o =>
    `${o.id}: ${o.name} ($${o.price})`
  ).join('\n');
}

export async function addToOrder(db: Database, deviceId: string, item: { id: number, name: string, price: number }) {
  const row = await db.get(`SELECT currentOrder FROM Sessions WHERE deviceId = ?`, [deviceId]);
  const currentOrder:OrderItem[] = JSON.parse(row?.currentOrder || '[]');

  const existing = currentOrder.find(i => i.name === item.name);
  if (existing) {
    existing.quantity += 1;
  } else {
    currentOrder.push({ ...item, quantity: 1 });
  }

  await db.run(
    `UPDATE Sessions SET currentOrder = ? WHERE deviceId = ?`,
    [JSON.stringify(currentOrder), deviceId]
  );
}

export async function handleCheckout(db: Database, deviceId: string, emit: Function) {
  const row = await db.get(`SELECT currentOrder FROM Sessions WHERE deviceId = ?`, [deviceId]);
  const currentOrder:OrderItem[] = JSON.parse(row?.currentOrder || '[]');

  if (currentOrder.length === 0) {
    emit('No order to place.');
    return emit(MAIN_MENU_TEXT);
  }

  await db.run(
    `INSERT INTO Orders (deviceId, items, status, createdAt) VALUES (?, ?, 'placed', datetime('now'))`,
    [deviceId, JSON.stringify(currentOrder)]
  );
  await db.run(`UPDATE Sessions SET currentOrder = ? WHERE deviceId = ?`, [JSON.stringify([]), deviceId]);
  emit('Order placed successfully!');
  return emit(MAIN_MENU_TEXT);
}

export async function handleOrderHistory(db: Database, deviceId: string, emit: Function) {
  const orders = await db.all(
    `SELECT * FROM Orders WHERE deviceId = ? AND status = 'placed' ORDER BY createdAt DESC LIMIT 5`,
    [deviceId]
  );
  if (orders.length === 0) {
    emit('No orders found.');
  } else {
    const formatted = orders.map((o, i) => {
        const items: OrderItem[] = JSON.parse(o.items);
        const itemSummary = items.map(i => `${i.quantity}x ${i.name}`).join(', ');
        return `Order #${o.id}: ${itemSummary} on ${o.createdAt}`;
      }).join('\n');

    emit(formatted);
  }
  emit(MAIN_MENU_TEXT);
}

export async function handleCurrentOrder(db: Database, deviceId: string, emit: Function) {
  const row = await db.get(`SELECT currentOrder FROM Sessions WHERE deviceId = ?`, [deviceId]);
  const currentOrder: OrderItem[] = JSON.parse(row?.currentOrder || '[]');

  if (currentOrder.length === 0) {
    emit('No current order.');
  } else {
    const summary = currentOrder.map(i =>
      `${i.quantity}x ${i.name} ($${i.price})`
    ).join('\n');
    emit('Current order:\n' + summary);
  }

  emit(MAIN_MENU_TEXT);
}

export async function handleCancelOrder(db: Database, deviceId: string, emit: Function) {
  const row = await db.get(`SELECT currentOrder FROM Sessions WHERE deviceId = ?`, [deviceId]);
  const currentOrder = JSON.parse(row?.currentOrder || '[]');

  if (currentOrder.length === 0) {
    emit('No order to cancel.');
  } else {
    await db.run(`UPDATE Sessions SET currentOrder = ? WHERE deviceId = ?`, [JSON.stringify([]), deviceId]);
    emit('Order cancelled.');
  }

  emit(MAIN_MENU_TEXT);
}

export function repeatMenu(state: string, emit: Function, contextItem?: MenuItem) {
    switch (state) {
      case 'main_menu':
        emit(MAIN_MENU_TEXT);
        break;
      case 'item_selection':
        emit(formatMenuItems());
        break;
      case 'sub_menu':
        if (contextItem) {
          emit(formatSubOptions(contextItem));
        } else {
          emit('Invalid sub-option context.');
        }
        break;
      default:
        emit('Unknown state. Returning to main menu.');
        emit(MAIN_MENU_TEXT);
    }
  }

export const MAIN_MENU_TEXT = `Welcome to the Restaurant ChatBot!
Select 1 to Place an order
Select 99 to checkout order
Select 98 to see order history
Select 97 to see current order
Select 0 to cancel order`;