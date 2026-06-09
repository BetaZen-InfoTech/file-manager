import { dbConnect } from '../db';
import { Plan, PlanDoc } from '@/models/Plan';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

const DEFAULT_PLANS = [
  {
    code: 'free',
    name: 'Free',
    description: 'Get started — 10 GB storage.',
    priceInr: 0,
    interval: 'month' as const,
    limits: { maxStorageBytes: 10 * GB, maxBuckets: 10, maxApiKeys: 10, maxFileSizeBytes: 500 * MB },
    active: true,
    sortOrder: 0
  },
  {
    code: 'pro',
    name: 'Pro',
    description: '100 GB storage, larger uploads, more buckets.',
    priceInr: 499,
    interval: 'month' as const,
    limits: { maxStorageBytes: 100 * GB, maxBuckets: 50, maxApiKeys: 50, maxFileSizeBytes: 2 * GB },
    active: true,
    sortOrder: 1
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description: '1 TB storage and high limits for teams.',
    priceInr: 1999,
    interval: 'month' as const,
    limits: { maxStorageBytes: 1024 * GB, maxBuckets: 500, maxApiKeys: 500, maxFileSizeBytes: 5 * GB },
    active: true,
    sortOrder: 2
  }
];

/** Seed the three default plans once, if the catalog is empty. */
export async function ensureDefaultPlans(): Promise<void> {
  await dbConnect();
  const count = await Plan.estimatedDocumentCount();
  if (count > 0) return;
  await Plan.insertMany(DEFAULT_PLANS);
}

export async function listPlans(activeOnly = false): Promise<PlanDoc[]> {
  await dbConnect();
  await ensureDefaultPlans();
  const q = activeOnly ? { active: true } : {};
  return Plan.find(q).sort({ sortOrder: 1, priceInr: 1 }).lean();
}

export async function getPlan(code: string): Promise<PlanDoc | null> {
  await dbConnect();
  return Plan.findOne({ code }).lean();
}
