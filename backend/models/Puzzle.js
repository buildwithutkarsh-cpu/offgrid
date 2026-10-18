const mongoose = require('mongoose');

const puzzleSchema = new mongoose.Schema({
  day: { type: Number, required: true, min: 1, max: 7 },
  date: { type: String, required: true },
  participantNumber: { type: Number, required: true },
  ticketCode: { type: String, required: true, uppercase: true, trim: true },
  puzzleType: { type: String, required: true },
  question: { type: String, required: true },
  hint1: { type: String, required: true },
  hint2: { type: String, required: true },
  answer: { type: String, required: true, select: false },
  cipherText: { type: String, required: true },
});

puzzleSchema.index({ day: 1, ticketCode: 1 }, { unique: true });

module.exports = mongoose.models.Puzzle || mongoose.model('Puzzle', puzzleSchema);
