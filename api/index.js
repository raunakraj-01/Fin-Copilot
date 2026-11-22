import app from '../server/src/app.js';
import { connectDb } from '../server/src/config/db.js';

export default async function handler(req, res) {
  if (process.env.MONGODB_URI) {
    try {
      await connectDb(process.env.MONGODB_URI);
    } catch (err) {
      console.error('Serverless database connection error:', err);
      return res.status(500).json({
        error: { code: 'DATABASE_ERROR', message: 'Database connection failed' },
      });
    }
  }
  return app(req, res);
}
