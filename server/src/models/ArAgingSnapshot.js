import mongoose from 'mongoose';

const customerLineSchema = new mongoose.Schema(
  {
    customerId: String,
    customerName: String,
    current: Number,
    b1_30: Number,
    b31_60: Number,
    b61_90: Number,
    b90plus: Number,
    total: Number,
    oldestDays: Number,
  },
  { _id: false }
);

const arAgingSnapshotSchema = new mongoose.Schema(
  {
    // One document per asOfDate — re-running on the same day overwrites it.
    asOfDate: { type: String, unique: true, index: true },
    source: String,
    totalReceivables: Number,
    totalOverdue: Number,
    overduePct: Number,
    customerCount: Number,
    oldestBalanceDays: Number,
    totals: {
      current: Number,
      b1_30: Number,
      b31_60: Number,
      b61_90: Number,
      b90plus: Number,
      total: Number,
    },
    customers: [customerLineSchema],
  },
  { timestamps: { createdAt: 'firstCapturedAt', updatedAt: 'lastCapturedAt' } }
);

export const ArAgingSnapshot =
  mongoose.models.ArAgingSnapshot || mongoose.model('ArAgingSnapshot', arAgingSnapshotSchema);
