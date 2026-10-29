import 'dotenv/config';
import app from './app.js';
import { connectDb } from './config/db.js';

const port = Number(process.env.PORT || 5000);
app.locals.localSyntheticDev = process.env.LOCAL_SYNTHETIC_DEV === '1'
  && /^mongodb:\/\/(?:127\.0\.0\.1|localhost):/.test(process.env.MONGODB_URI || '');

try {
  await connectDb(process.env.MONGODB_URI);
  app.listen(port, () => console.log(`API listening at http://localhost:${port}/api`));
} catch (error) {
  console.error('Unable to start API:', error);
  process.exitCode = 1;
}
