import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const ThumbnailSchema = new Schema(
  {
    size: { type: String, enum: ['sm', 'md', 'lg'], required: true },
    storageKey: { type: String, required: true },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 }
  },
  { _id: false }
);

const FileSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    bucketId: { type: Schema.Types.ObjectId, ref: 'Bucket', required: true, index: true },
    folderId: { type: Schema.Types.ObjectId, ref: 'Folder', default: null },

    originalName: { type: String, required: true },
    // NOT unique: content-dedup intentionally lets multiple File rows share one
    // storage object (see upload dedup + purge-trash refcount). A unique index
    // here makes the 2nd identical-content upload fail with E11000.
    storageKey: { type: String, required: true, index: true },
    extension: { type: String, default: '' },

    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    checksum: {
      md5: { type: String, default: '' },
      sha256: { type: String, default: '', index: true }
    },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
    pageCount: { type: Number, default: 0 },

    thumbnails: { type: [ThumbnailSchema], default: [] },

    tags: { type: [String], default: [] },
    metadata: { type: Schema.Types.Mixed, default: {} },
    isHidden: { type: Boolean, default: false },
    hiddenBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    hiddenAt: { type: Date, default: null },

    version: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ['ready', 'uploading', 'failed', 'trashed'],
      default: 'ready',
      index: true
    },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    uploadSource: { type: String, enum: ['ui', 'api'], default: 'ui' },
    apiKeyId: { type: Schema.Types.ObjectId, ref: 'ApiKey', default: null },

    deletedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

FileSchema.index({ vendorId: 1, bucketId: 1, folderId: 1 });
FileSchema.index({ vendorId: 1, status: 1 });
FileSchema.index({ originalName: 'text', tags: 'text' });
// Idempotency for server-to-server transfer: one copy per source file id per
// vendor. Partial filter so normal files (no sourceFileId) don't collide on null.
FileSchema.index(
  { vendorId: 1, 'metadata.sourceFileId': 1 },
  { unique: true, partialFilterExpression: { 'metadata.sourceFileId': { $type: 'string' } } }
);

export type FileDoc = InferSchemaType<typeof FileSchema> & { _id: mongoose.Types.ObjectId };

export const FileModel: Model<FileDoc> =
  (mongoose.models.File as Model<FileDoc>) || mongoose.model<FileDoc>('File', FileSchema);
