import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const AuditLogSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
    actorId: { type: Schema.Types.ObjectId, default: null },
    actorType: { type: String, enum: ['user', 'apikey', 'system'], default: 'user' },
    actorEmail: { type: String, default: null },
    action: { type: String, required: true, index: true },
    resourceType: { type: String, default: null },
    resourceId: { type: String, default: null },
    ip: { type: String, default: null },
    ipChain: { type: String, default: null }, // full X-Forwarded-For chain
    method: { type: String, default: null }, // HTTP method
    url: { type: String, default: null }, // request path (secrets stripped)
    host: { type: String, default: null }, // which server/domain handled it
    referer: { type: String, default: null },
    country: { type: String, default: null },
    city: { type: String, default: null },
    region: { type: String, default: null },
    userAgent: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ vendorId: 1, createdAt: -1 });

export type AuditLogDoc = InferSchemaType<typeof AuditLogSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const AuditLog: Model<AuditLogDoc> =
  (mongoose.models.AuditLog as Model<AuditLogDoc>) ||
  mongoose.model<AuditLogDoc>('AuditLog', AuditLogSchema);
