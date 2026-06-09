import mongoose from 'mongoose';

/** Generic key/value store for app-wide settings (one doc per key). */
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, index: true },
    value: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

export const Setting =
  mongoose.models.Setting || mongoose.model('Setting', settingSchema);
