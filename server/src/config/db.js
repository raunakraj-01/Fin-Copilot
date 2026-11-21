import mongoose from 'mongoose';

let cachedPromise = null;

export async function connectDb(uri) {
  if (!uri) throw new Error('MONGODB_URI is required');
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  if (!cachedPromise || mongoose.connection.readyState === 0) {
    cachedPromise = mongoose.connect(uri).catch(err => {
      cachedPromise = null;
      throw err;
    });
  }
  return cachedPromise;
}
