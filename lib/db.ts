import mongoose from 'mongoose';
import { env } from './env';

type Cached = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

const globalForMongoose = global as unknown as { _mongoose?: Cached };

const cache: Cached = globalForMongoose._mongoose || { conn: null, promise: null };
if (!globalForMongoose._mongoose) globalForMongoose._mongoose = cache;

export async function dbConnect(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose.connect(env.MONGODB_URI, {
      maxPoolSize: 20,
      serverSelectionTimeoutMS: 10_000
    });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}

export { mongoose };
