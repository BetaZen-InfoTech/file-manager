import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

export const ROLES = [
  'super_admin',
  'platform_staff',
  'vendor_owner',
  'vendor_admin',
  'vendor_member'
] as const;
export type Role = (typeof ROLES)[number];

const UserSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    name: { type: String, default: '' },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    permissions: { type: [String], default: [] },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    twoFactor: {
      enabled: { type: Boolean, default: false },
      secret: { type: String, default: null }
    },
    lastLoginAt: { type: Date, default: null }
  },
  { timestamps: true }
);

UserSchema.index({ vendorId: 1, role: 1 });

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: mongoose.Types.ObjectId };

export const User: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) || mongoose.model<UserDoc>('User', UserSchema);
