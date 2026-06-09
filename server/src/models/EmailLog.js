import mongoose from 'mongoose';

const emailLogSchema = new mongoose.Schema(
  {
    customerId: { type: String, index: true },
    customerName: String,
    customerEmail: String,    // email on file in MYOB
    recipient: String,         // actual delivery address (test or real)
    subject: String,
    sentBy: String,            // name of the app user who triggered the send
    sentById: String,          // their user id
    status: { type: String, enum: ['sent', 'failed'], index: true },
    error: String,
    transport: String,         // 'smtp' or 'graph'
    testMode: Boolean,
    overdueAmount: Number,
    asOfDate: String,
  },
  { timestamps: { createdAt: 'sentAt', updatedAt: false } }
);

emailLogSchema.index({ sentAt: -1 });

export const EmailLog =
  mongoose.models.EmailLog || mongoose.model('EmailLog', emailLogSchema);
