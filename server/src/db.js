import mongoose from 'mongoose';
import { config } from './config.js';

let connecting = null;

export async function connectDb() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!config.mongo.uri) {
    console.warn('MONGODB_URI not set — running without database persistence.');
    return null;
  }
  if (connecting) return connecting;

  connecting = mongoose
    .connect(config.mongo.uri, {
      dbName: config.mongo.dbName,
      serverSelectionTimeoutMS: 10_000,
    })
    .then(() => {
      console.log(`MongoDB connected (db: ${config.mongo.dbName})`);
      return mongoose.connection;
    })
    .catch((err) => {
      console.error('MongoDB connection failed:', err.message);
      return null;
    })
    .finally(() => {
      connecting = null;
    });

  return connecting;
}

export function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

export async function disconnectDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
