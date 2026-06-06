import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const PlatformSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

export type PlatformSettingsDoc = InferSchemaType<typeof PlatformSettingsSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const PlatformSettings: Model<PlatformSettingsDoc> =
  (mongoose.models.PlatformSettings as Model<PlatformSettingsDoc>) ||
  mongoose.model<PlatformSettingsDoc>('PlatformSettings', PlatformSettingsSchema);
