import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const JwtRevocationSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    jti: { type: String, required: true, unique: true, index: true },
    subject: { type: String, default: '' },
    revokedAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, default: null }
  },
  { timestamps: true }
);

// Auto-purge revocations once the underlying JWT can no longer be valid (the
// revoke route stamps expiresAt past the max possible token lifetime). Keeps the
// collection — and the per-download lookup — from growing without bound.
JwtRevocationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type JwtRevocationDoc = InferSchemaType<typeof JwtRevocationSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const JwtRevocation: Model<JwtRevocationDoc> =
  (mongoose.models.JwtRevocation as Model<JwtRevocationDoc>) ||
  mongoose.model<JwtRevocationDoc>('JwtRevocation', JwtRevocationSchema);
