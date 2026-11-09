import 'dotenv/config';
import dns from 'node:dns/promises';
import tls from 'node:tls';
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is missing');
const parsed = new URL(uri);
if (parsed.protocol !== 'mongodb+srv:') throw new Error('Expected an Atlas SRV URI');
const hostname = parsed.hostname;
const records = await dns.resolveSrv(`_mongodb._tcp.${hostname}`);
console.log(`SRV hosts: ${records.length}`);

async function probe(host, port) {
  return new Promise(resolve => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true, timeout: 8000 });
    socket.once('secureConnect', () => { console.log(`${host}: TLS OK, authorized=${socket.authorized}, protocol=${socket.getProtocol()}`); socket.end(); resolve(); });
    socket.once('error', error => { console.log(`${host}: TLS ${error.code || error.name}: ${error.message}`); socket.destroy(); resolve(); });
    socket.once('timeout', () => { console.log(`${host}: TLS TIMEOUT`); socket.destroy(); resolve(); });
  });
}
await Promise.all(records.map(record => probe(record.name, record.port)));

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 12000, connectTimeoutMS: 7000, autoIndex: false });
  console.log('MongoDB driver ping:', (await mongoose.connection.db.command({ ping: 1 })).ok);
} catch (error) {
  console.log('MongoDB driver:', error.name);
  const servers = [...(error.reason?.servers?.entries() || [])];
  for (const [host, state] of servers) console.log(`${host}: ${state.type}; ${state.error?.code || state.error?.name || 'no code'}; ${state.error?.message || 'no message'}`);
} finally {
  await mongoose.disconnect();
}
