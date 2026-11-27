import mongoose from 'mongoose';

let cachedPromise = null;

export async function connectDb(uri, options = {}) {
  if (!uri) throw new Error('MONGODB_URI is required');
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  if (!cachedPromise || mongoose.connection.readyState === 0) {
    const connectOptions = {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
      ...options,
    };
    cachedPromise = mongoose.connect(uri, connectOptions).catch(err => {
      cachedPromise = null;
      throw err;
    });
  }
  return cachedPromise;
}
