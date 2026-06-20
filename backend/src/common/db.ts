import mongoose from 'mongoose';
import { config } from '../config';

let isConnected = false;

export async function connectDatabase(): Promise<void> {
  if (isConnected) return;
  await mongoose.connect(config.mongoUri);
  isConnected = true;
  console.log(`MongoDB connected: ${config.mongoUri}`);
}

export async function disconnectDatabase(): Promise<void> {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
}
