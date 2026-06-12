import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

export const TRANSFER_TOKEN_COLLECTION = 'transfertokens';

const TransferTokenSchema = new Schema(
  {
    // Only sha256(token) is stored; the plaintext fmt_… lives only in the link.
    tokenHash: { type: String, required: true, unique: true, index: true },
    scope: {
      kind: { type: String, enum: ['instance', 'vendor'], default: 'instance' },
      vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null },
      bucketIds: { type: [Schema.Types.ObjectId], default: [] }
    },
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
    label: { type: String, default: '' },
    // Required, but NO `index:true` here — the single TTL index below owns this
    // key (a second index on expiresAt causes IndexOptionsConflict).
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true, collection: TRANSFER_TOKEN_COLLECTION }
);

TransferTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type TransferTokenDoc = InferSchemaType<typeof TransferTokenSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const TransferToken: Model<TransferTokenDoc> =
  (mongoose.models.TransferToken as Model<TransferTokenDoc>) ||
  mongoose.model<TransferTokenDoc>('TransferToken', TransferTokenSchema);
