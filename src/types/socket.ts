import { Socket } from 'socket.io';

export interface CustomSocket extends Socket {
  emit: (event: string, ...args: any[]) => boolean;
  on: (event: string, listener: (...args: any[]) => void) => this;
  disconnect: () => this;
  deviceId: string;
  sessionData: {
    state: string;
    selectedItemId?: number;
    lastInputTime: number;
  };
}