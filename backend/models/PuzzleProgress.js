const mongoose = require('mongoose');

const puzzleProgressSchema = new mongoose.Schema({
  day: { type: Number, required: true, min: 1, max: 7 },
  ticketCode: { type: String, required: true, uppercase: true, trim: true },
  attempts: { type: Number, default: 0 },
  solvedAt: { type: Date, default: null },
}, { timestamps: true });

puzzleProgressSchema.index({ day: 1, ticketCode: 1 }, { unique: true });

module.exports = mongoose.models.PuzzleProgress || mongoose.model('PuzzleProgress', puzzleProgressSchema);
