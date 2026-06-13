import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const VendorSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    // Folder-safe handle ([a-z0-9_]) auto-derived from the name on create. Names
    // the vendor's private server folder (/var/www/vendors/<username>). Optional
    // so legacy vendors (created before usernames) keep working via the id.
    username: { type: String, default: null, lowercase: true, trim: true },
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
    subscription: {
      planCode: { type: String, default: 'free' },
      status: {
        type: String,
        enum: ['none', 'active', 'expired', 'pending'],
        default: 'none'
      },
      gateway: { type: String, default: null },
      currentPeriodEnd: { type: Date, default: null },
      lastPaymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null }
    },
    contactEmail: { type: String, default: null }
  },
  { timestamps: true }
);

// Unique only among vendors that actually have a username (legacy nulls excluded).
VendorSchema.index(
  { username: 1 },
  { unique: true, partialFilterExpression: { username: { $type: 'string' } } }
);

export type VendorDoc = InferSchemaType<typeof VendorSchema> & { _id: mongoose.Types.ObjectId };

export const Vendor: Model<VendorDoc> =
  (mongoose.models.Vendor as Model<VendorDoc>) ||
  mongoose.model<VendorDoc>('Vendor', VendorSchema);
