import mongoose, { Schema, InferSchemaType, Model } from 'mongoose';

const PaymentSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    planCode: { type: String, required: true },
    gateway: { type: String, enum: ['razorpay', 'phonepe'], required: true },
    amountInr: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    interval: { type: String, enum: ['month', 'year'], default: 'month' },

    status: {
      type: String,
      enum: ['created', 'paid', 'failed'],
      default: 'created',
      index: true
    },

    // Gateway references
    gatewayOrderId: { type: String, default: '', index: true }, // razorpay order_id / phonepe merchantTransactionId
    gatewayPaymentId: { type: String, default: '' },
    gatewayRef: { type: String, default: '' },

    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    raw: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

export type PaymentDoc = InferSchemaType<typeof PaymentSchema> & { _id: mongoose.Types.ObjectId };

export const Payment: Model<PaymentDoc> =
  (mongoose.models.Payment as Model<PaymentDoc>) ||
  mongoose.model<PaymentDoc>('Payment', PaymentSchema);
