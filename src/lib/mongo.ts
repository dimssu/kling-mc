import mongoose from "mongoose";
import { getEnv } from "./env";

type GlobalWithMongo = typeof globalThis & {
  __mongoose__?: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
};

const g = globalThis as GlobalWithMongo;
g.__mongoose__ ??= { conn: null, promise: null };

export async function connectMongo(): Promise<typeof mongoose> {
  if (g.__mongoose__!.conn) return g.__mongoose__!.conn;
  if (!g.__mongoose__!.promise) {
    const env = getEnv();
    g.__mongoose__!.promise = mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB,
      bufferCommands: false,
    });
  }
  g.__mongoose__!.conn = await g.__mongoose__!.promise;
  return g.__mongoose__!.conn;
}
