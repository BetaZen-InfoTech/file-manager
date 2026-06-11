import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const StepSchema = new Schema(
  { name: String, status: { type: String, default: 'pending' }, detail: { type: String, default: '' } },
  { _id: false }
);
const LogSchema = new Schema(
  { ts: { type: Date, default: Date.now }, level: { type: String, default: 'info' }, message: String },
  { _id: false }
);

const MigrationSchema = new Schema(
  {
    // Source: any S3-compatible storage on the other server (MinIO / S3 / Spaces).
    source: {
      endpoint: { type: String, required: true },
      region: { type: String, default: 'us-east-1' },
      accessKeyEnc: { type: String, default: '' },
      secretKeyEnc: { type: String, default: '' },
      bucket: { type: String, required: true },
      prefix: { type: String, default: '' },
      forcePathStyle: { type: Boolean, default: true }
    },
    // Destination on THIS server.
    targetVendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    targetBucketName: { type: String, required: true },

    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true
    },
    progress: { type: Number, default: 0 }, // 0-100
    totals: { objects: { type: Number, default: 0 }, bytes: { type: Number, default: 0 } },
    done: {
      objects: { type: Number, default: 0 },
      bytes: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      failed: { type: Number, default: 0 }
    },
    currentItem: { type: String, default: '' },
    steps: { type: [StepSchema], default: [] },
    logs: { type: [LogSchema], default: [] },
    error: { type: String, default: '' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export type MigrationDoc = InferSchemaType<typeof MigrationSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Migration: Model<MigrationDoc> =
  (mongoose.models.Migration as Model<MigrationDoc>) ||
  mongoose.model<MigrationDoc>('Migration', MigrationSchema);
