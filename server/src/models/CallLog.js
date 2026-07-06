import mongoose from 'mongoose';

const callLogSchema = new mongoose.Schema(
  {
    customerId: { type: String, index: true },
    customerName: String,
    customerPhone: String, // number on file in MYOB
    recipient: String, // actual dialled number (test or real, E.164)
    // The provider's call id — the join key the webhook uses to resolve outcome.
    callId: { type: String, index: true },
    calledBy: String, // name of the app user who triggered the call
    calledById: String, // their user id
    // Lifecycle: 'initiated' (accepted by provider) → resolved by the webhook.
    status: {
      type: String,
      enum: ['initiated', 'completed', 'no-answer', 'failed', 'skipped'],
      index: true,
    },
    error: String,
    provider: String, // 'vapi'
    testMode: Boolean,
    overdueAmount: Number,
    asOfDate: String,
    // ---- Filled in by the end-of-call webhook ----
    outcome: String, // free-text summary from the assistant
    promiseToPayDate: String,
    claimsAlreadyPaid: Boolean,
    disputeReason: String,
    durationSec: Number,
    transcript: String,
    recordingUrl: String,
    endedReason: String, // provider's hangup reason
  },
  { timestamps: { createdAt: 'startedAt', updatedAt: 'updatedAt' } }
);

callLogSchema.index({ startedAt: -1 });

export const CallLog =
  mongoose.models.CallLog || mongoose.model('CallLog', callLogSchema);
