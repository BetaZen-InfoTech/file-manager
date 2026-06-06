import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

export const LINK_TYPES = ['public', 'private', 'temporary'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

const LinkSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    fileId: { type: Schema.Types.ObjectId, ref: 'File', required: true, index: true },
    type: { type: String, enum: LINK_TYPES, required: true },
    token: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, default: null },
    maxDownloads: { type: Number, default: null },
    downloadCount: { type: Number, default: 0 },
    requiredScope: { type: String, default: 'file:download' },
    passwordHash: { type: String, default: null },
    status: {
      type: String,
      enum: ['active', 'revoked', 'expired'],
      default: 'active',
      index: true
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, default: '' }
  },
  { timestamps: true }
);

LinkSchema.index({ vendorId: 1, fileId: 1, status: 1 });

export type LinkDoc = InferSchemaType<typeof LinkSchema> & { _id: mongoose.Types.ObjectId };

export const Link: Model<LinkDoc> =
  (mongoose.models.Link as Model<LinkDoc>) || mongoose.model<LinkDoc>('Link', LinkSchema);
