import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const ApiKeySchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    name: { type: String, required: true },
    keyHash: { type: String, required: true, unique: true, index: true },
    prefix: { type: String, required: true },
    permissions: { type: [String], default: [] },
    bucketIds: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    lastUsedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

export type ApiKeyDoc = InferSchemaType<typeof ApiKeySchema> & { _id: mongoose.Types.ObjectId };

export const ApiKey: Model<ApiKeyDoc> =
  (mongoose.models.ApiKey as Model<ApiKeyDoc>) ||
  mongoose.model<ApiKeyDoc>('ApiKey', ApiKeySchema);
