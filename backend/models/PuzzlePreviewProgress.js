const mongoose = require('mongoose');

const puzzlePreviewProgressSchema = new mongoose.Schema({
  day: { type: Number, required: true, min: 1, max: 7 },
  ticketCode: { type: String, required: true, uppercase: true, trim: true },
  attempts: { type: Number, default: 0 },
  solvedAt: { type: Date, default: null },
}, { timestamps: true });

puzzlePreviewProgressSchema.index({ day: 1, ticketCode: 1 }, { unique: true });

module.exports = mongoose.models.PuzzlePreviewProgress
  || mongoose.model('PuzzlePreviewProgress', puzzlePreviewProgressSchema);
