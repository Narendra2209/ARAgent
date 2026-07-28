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
    // Branch assignment set from the Customers page. MYOB sends no branch, so
    // when this is unset the seed list in branchMap.js is used instead. Stored
    // as '' to mean "deliberately no branch" — see resolveBranch().
    branch: { type: String, default: undefined },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Customer =
  mongoose.models.Customer || mongoose.model('Customer', customerSchema);
