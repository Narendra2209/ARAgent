import mongoose from 'mongoose';

/**
 * A user-authored note pinned to a calendar day. Optionally tied to a customer.
 * `date` is a YYYY-MM-DD string so it maps cleanly onto a calendar cell without
 * timezone drift; `createdAt` is the real timestamp it was written.
 */
const commentSchema = new mongoose.Schema(
  {
    date: { type: String, index: true }, // YYYY-MM-DD the note belongs to
    body: { type: String, required: true },
    type: { type: String, default: 'note' }, // note | call | followup | promise
    customerId: { type: String, index: true },
    customerName: String,
    createdBy: String, // name of the author
    createdById: String,
  },
  { timestamps: true }
);

export const Comment =
  mongoose.models.Comment || mongoose.model('Comment', commentSchema);
