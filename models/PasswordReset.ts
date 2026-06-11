import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const PasswordResetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Only the SHA-256 hash of the token is stored; the plain token lives only
    // in the emailed link.
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false }
  },
  { timestamps: true }
);

// TTL index — Mongo auto-deletes documents once expiresAt passes.
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type PasswordResetDoc = InferSchemaType<typeof PasswordResetSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const PasswordReset: Model<PasswordResetDoc> =
  (mongoose.models.PasswordReset as Model<PasswordResetDoc>) ||
  mongoose.model<PasswordResetDoc>('PasswordReset', PasswordResetSchema);
