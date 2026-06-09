import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const PlanSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true }, // free | pro | enterprise | custom
    name: { type: String, required: true },
    description: { type: String, default: '' },
    priceInr: { type: Number, required: true, default: 0 }, // rupees; 0 = free
    interval: { type: String, enum: ['month', 'year'], default: 'month' },
    limits: {
      maxStorageBytes: { type: Number, default: 10 * 1024 * 1024 * 1024 },
      maxBuckets: { type: Number, default: 10 },
      maxApiKeys: { type: Number, default: 10 },
      maxFileSizeBytes: { type: Number, default: 500 * 1024 * 1024 }
    },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 }
  },
  { timestamps: true }
);

export type PlanDoc = InferSchemaType<typeof PlanSchema> & { _id: mongoose.Types.ObjectId };

export const Plan: Model<PlanDoc> =
  (mongoose.models.Plan as Model<PlanDoc>) || mongoose.model<PlanDoc>('Plan', PlanSchema);
