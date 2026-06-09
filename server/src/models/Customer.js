import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema(
  {
    customerId: { type: String, unique: true, index: true },
    customerName: String,
    email: String,                // last value synced from MYOB
    phone: String,                // last value synced from MYOB
    creditLimit: Number,
    usingDefaultEmail: Boolean,
    emailOverride: String,        // user-edited; wins over MYOB email when set
    phoneOverride: String,        // user-edited; wins over MYOB phone when set
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Customer =
  mongoose.models.Customer || mongoose.model('Customer', customerSchema);
