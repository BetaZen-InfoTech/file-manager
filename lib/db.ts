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
    cache.promise = mongoose
      .connect(env.MONGODB_URI, {
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 10_000
      })
      .catch((err) => {
        // Never cache a REJECTED connect promise. Otherwise a transient Mongo
        // outage at first-connect poisons the cache: every later request awaits
        // the same rejected promise and fails instantly — even after Mongo comes
        // back — until the process is restarted. Clearing it lets the next call retry.
        cache.promise = null;
        throw err;
      });
  }
  try {
    cache.conn = await cache.promise;
  } catch (err) {
    cache.conn = null;
    throw err;
  }
  return cache.conn;
}

export { mongoose };
