import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const VendorSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ['active', 'suspended', 'pending'],
      default: 'active',
      index: true
    },
    suspendedReason: { type: String, default: null },
    plan: {
      type: String,
      enum: ['free', 'pro', 'enterprise'],
      default: 'free'
    },
    limits: {
      maxStorageBytes: { type: Number, default: 10 * 1024 * 1024 * 1024 },
      maxBuckets: { type: Number, default: 10 },
      maxApiKeys: { type: Number, default: 10 },
      maxFileSizeBytes: { type: Number, default: 500 * 1024 * 1024 }
    },
    usage: {
      storageBytes: { type: Number, default: 0 },
      fileCount: { type: Number, default: 0 }
    },
    contactEmail: { type: String, default: null }
  },
  { timestamps: true }
);

export type VendorDoc = InferSchemaType<typeof VendorSchema> & { _id: mongoose.Types.ObjectId };

export const Vendor: Model<VendorDoc> =
  (mongoose.models.Vendor as Model<VendorDoc>) ||
  mongoose.model<VendorDoc>('Vendor', VendorSchema);
