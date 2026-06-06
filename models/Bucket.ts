import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const BucketSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    isPublic: { type: Boolean, default: false },
    storageBytes: { type: Number, default: 0 },
    fileCount: { type: Number, default: 0 },
    settings: {
      allowedMimeTypes: { type: [String], default: [] },
      maxFileSizeBytes: { type: Number, default: 0 }
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

BucketSchema.index({ vendorId: 1, name: 1 }, { unique: true });

export type BucketDoc = InferSchemaType<typeof BucketSchema> & { _id: mongoose.Types.ObjectId };

export const Bucket: Model<BucketDoc> =
  (mongoose.models.Bucket as Model<BucketDoc>) ||
  mongoose.model<BucketDoc>('Bucket', BucketSchema);
