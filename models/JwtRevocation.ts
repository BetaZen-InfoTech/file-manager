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

export type JwtRevocationDoc = InferSchemaType<typeof JwtRevocationSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const JwtRevocation: Model<JwtRevocationDoc> =
  (mongoose.models.JwtRevocation as Model<JwtRevocationDoc>) ||
  mongoose.model<JwtRevocationDoc>('JwtRevocation', JwtRevocationSchema);
