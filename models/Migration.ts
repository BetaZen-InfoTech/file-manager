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
    // 's3' = import from S3-compatible storage; 'bcdnp' = pull files from another
    // file-manager install; 'bcdnp-full' = full platform migration (vendors,
    // users, keys, buckets, files, links, billing, settings) from another install.
    sourceType: { type: String, enum: ['s3', 'bcdnp', 'bcdnp-full'], default: 's3' },

    // S3 source (MinIO / S3 / Spaces). Optional now (only set when sourceType=s3).
    source: {
      endpoint: { type: String, default: '' },
      region: { type: String, default: 'us-east-1' },
      accessKeyEnc: { type: String, default: '' },
      secretKeyEnc: { type: String, default: '' },
      bucket: { type: String, default: '' },
      prefix: { type: String, default: '' },
      forcePathStyle: { type: Boolean, default: true }
    },

    // bcdnp source (another file-manager). tokenEnc = encrypted transfer token.
    bcdnp: {
      baseUrl: { type: String, default: '' },
      tokenEnc: { type: String, default: '' }
    },
    // Destination on THIS server (single-bucket file imports). Not used by a
    // full platform migration, which imports ALL vendors.
    targetVendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null },
    targetBucketName: { type: String, default: '' },

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
    // Per-entity counts for a full migration (vendors/users/files/links/…).
    report: { type: Schema.Types.Mixed, default: {} },
    steps: { type: [StepSchema], default: [] },
    logs: { type: [LogSchema], default: [] },
    error: { type: String, default: '' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    // Liveness for resume: a 'running' job whose heartbeat is stale can be reclaimed.
    heartbeatAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export type MigrationDoc = InferSchemaType<typeof MigrationSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Migration: Model<MigrationDoc> =
  (mongoose.models.Migration as Model<MigrationDoc>) ||
  mongoose.model<MigrationDoc>('Migration', MigrationSchema);
