import { dbConnect } from './db';
import { PlatformSettings } from '@/models/PlatformSettings';

export interface MaintenanceState {
  enabled: boolean;
  message: string;
  updatedAt: Date | null;
}

let cache: { value: MaintenanceState; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5_000;

export async function getMaintenance(): Promise<MaintenanceState> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.value;
  await dbConnect();
  const doc = await PlatformSettings.findOne({ key: 'maintenance' }).lean();
  const value: MaintenanceState = {
    enabled: Boolean(doc?.value?.enabled),
    message: String(doc?.value?.message || 'Be right back — scheduled maintenance.'),
    updatedAt: doc?.updatedAt ? new Date(doc.updatedAt) : null
  };
  cache = { value, loadedAt: now };
  return value;
}

export async function setMaintenance(
  enabled: boolean,
  message: string,
  updatedBy: string | null
): Promise<MaintenanceState> {
  await dbConnect();
  await PlatformSettings.findOneAndUpdate(
    { key: 'maintenance' },
    { $set: { value: { enabled, message }, updatedBy } },
    { upsert: true }
  );
  cache = null;
  return getMaintenance();
}
