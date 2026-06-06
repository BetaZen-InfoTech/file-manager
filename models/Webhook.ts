import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const WebhookSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    url: { type: String, required: true },
    secret: { type: String, required: true },
    events: { type: [String], default: [] },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    lastDeliveryAt: { type: Date, default: null },
    lastStatusCode: { type: Number, default: null },
    failureCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

export type WebhookDoc = InferSchemaType<typeof WebhookSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Webhook: Model<WebhookDoc> =
  (mongoose.models.Webhook as Model<WebhookDoc>) ||
  mongoose.model<WebhookDoc>('Webhook', WebhookSchema);
