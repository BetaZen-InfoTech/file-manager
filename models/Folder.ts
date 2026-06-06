import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const FolderSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    bucketId: { type: Schema.Types.ObjectId, ref: 'Bucket', required: true, index: true },
    name: { type: String, required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Folder', default: null },
    path: { type: String, required: true, default: '/' },
    isHidden: { type: Boolean, default: false },
    hiddenBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    hiddenAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

FolderSchema.index({ vendorId: 1, bucketId: 1, parentId: 1 });
FolderSchema.index({ vendorId: 1, bucketId: 1, path: 1 });

export type FolderDoc = InferSchemaType<typeof FolderSchema> & { _id: mongoose.Types.ObjectId };

export const Folder: Model<FolderDoc> =
  (mongoose.models.Folder as Model<FolderDoc>) ||
  mongoose.model<FolderDoc>('Folder', FolderSchema);
