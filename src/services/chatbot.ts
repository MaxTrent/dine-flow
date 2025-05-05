import { Database } from "sqlite";
import {menu} from "../models/menu"; 
import {
    formatMenuItems,
    formatSubOptions,
    addToOrder,
    handleCheckout,
    handleCancelOrder,
    handleOrderHistory,
    handleCurrentOrder,
    MAIN_MENU_TEXT
  } from '../utils/chatUtils';

type BotState = 'main_menu' | 'item_selection' | 'sub_menu'

interface ChatSessionContext {
    state: BotState;
    selectedItemId?: number;
}

// const userContext: { [deviceId: string]: ChatSessionContext } = {};
const userContexts = new Map<string, ChatSessionContext>();



export async function handleMessage(db: Database, socket: any, deviceId: string, input: string) {
    const ctx = userContexts.get(deviceId) || { state: 'main_menu' };
    const msg = input.trim();
  
    const emit = (text: string) => {
      socket.emit('message', { text });
      console.log(`[${deviceId}] <<< ${text}`);
    };

    console.log(`[${deviceId}] >>> ${msg}`);

    const isNumber = /^\d+$/.test(msg);
    if (!isNumber) {
      emit('Invalid input, please enter a number.');
      return repeatMenu(session.state, emit, selectedItem);
    }
  
    const num = parseInt(msg, 10);

    if (ctx.state === 'main_menu') {
        switch (num) {
          case 1:
            ctx.state = 'item_selection';
            userContexts.set(deviceId, ctx);
            return emit(formatMenuItems());
    
          case 99:
            return handleCheckout(db, deviceId, emit);
    
          case 98:
            return handleOrderHistory(db, deviceId, emit);
    
          case 97:
            return handleCurrentOrder(db, deviceId, emit);
    
          case 0:
            return handleCancelOrder(db, deviceId, emit);
    
          default:
            emit('Invalid selection.');
            return repeatMenu(session.state, emit, selectedItem);
        }
      }

      if (ctx.state === 'item_selection') {
        const item = menu.find(i => i.id === num);
        if (!item) {
          emit('Invalid item. Please select from the menu.');
          return emit(formatMenuItems());
        }
    
        if (item.options) {
          ctx.state = 'sub_menu';
          ctx.selectedItemId = item.id;
          userContexts.set(deviceId, ctx);
          return emit(formatSubOptions(item));
        } else {
          await addToOrder(db, deviceId, item);
          return emit(`Added ${item.name} to your order.\n` + formatMenuItems());
        }
      }

      if (ctx.state === 'sub_menu') {
        const parent = menu.find(i => i.id === ctx.selectedItemId);
        if (!parent || !parent.options) {
          ctx.state = 'main_menu';
          userContexts.set(deviceId, ctx);
          return emit(MAIN_MENU_TEXT);
        }
    
        const opt = parent.options.find(o => o.id === num);
        if (!opt) {
          emit('Invalid sub-option.');
          return emit(formatSubOptions(parent));
        }
    
        await addToOrder(db, deviceId, {
          id: parent.id * 100 + opt.id,
          name: `${parent.name} - ${opt.name}`,
          price: opt.price
        });
    
        ctx.state = 'item_selection';
        userContexts.set(deviceId, ctx);
        return emit(`Added ${parent.name} - ${opt.name} to your order.\n` + formatMenuItems());
      }
    
      emit('Something went wrong. Resetting...');
      userContexts.delete(deviceId);
      return emit(MAIN_MENU_TEXT);
    }

    