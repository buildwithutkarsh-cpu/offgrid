const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { parse } = require('csv-parse/sync');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const Puzzle = require('./models/Puzzle');
const sourcePath = path.join(__dirname, '..', 'tmp', 'puzzle.csv');
const requiredColumns = ['Day', 'Date', 'Participant #', 'Ticket code', 'Puzzle type', 'Answer', 'Cipher text'];
const puzzleGuides = {
  Backwards: {
    question: 'What word is hidden in this reversed and shifted signal?',
    hint1: 'The letters were reversed before the signal was sent.',
    hint2: 'Reverse the text, then move every letter one place backward in the alphabet.',
  },
  Count: {
    question: 'Which word is encoded by these alphabet-position numbers?',
    hint1: 'Each number points to a letter in the alphabet.',
    hint2: 'Use A=1, B=2, through Z=26, keeping the numbers in order.',
  },
  'Double Cipher A': {
    question: 'What word is concealed beneath two layers of alphabet code?',
    hint1: 'The text has two transformations. Try a simple alphabet shift or reflection first.',
    hint2: 'After the first pass, treat the result as another ciphertext rather than a finished word.',
  },
  'Double Cipher B': {
    question: 'What word is hidden in this Morse-and-mirror transmission?',
    hint1: 'Translate each Morse group into a letter first.',
    hint2: 'Reflect each decoded letter across the alphabet: A↔Z, B↔Y, and so on.',
  },
  'Double Cipher C': {
    question: 'Which word is concealed in these shifted alphabet positions?',
    hint1: 'The numbers are letter positions, but the first conversion is not the final answer.',
    hint2: 'Convert each number with A=1 through Z=26, then undo the second letter shift.',
  },
  'Double Cipher D': {
    question: 'What message is hidden in this woven two-layer cipher?',
    hint1: 'The two rows are interleaved: take one letter from TOP, then one from BOTTOM.',
    hint2: 'After weaving the letters together, decode the resulting second layer.',
  },
  'Double Cipher E': {
    question: 'What word is hidden in this Braille-and-mirror transmission?',
    hint1: 'Translate the Braille cells into letters first.',
    hint2: 'Reflect each decoded letter across the alphabet: A↔Z, B↔Y, and so on.',
  },
  'Fat Fingers': {
    question: 'Which intended word is hidden by these neighboring key presses?',
    hint1: 'Imagine the typist hit nearby QWERTY keys by mistake.',
    hint2: 'Each cipher character is one key to the right on QWERTY. Decode by moving one key left.',
  },
  Grid: {
    question: 'What word do these coordinates spell in a 5×5 alphabet grid?',
    hint1: 'Read each pair as row, then column.',
    hint2: 'The alphabet is arranged left-to-right, top-to-bottom; I and J share one cell.',
  },
  Hex: {
    question: 'What text do these hexadecimal bytes represent?',
    hint1: 'Each pair of hex digits represents one byte.',
    hint2: 'Convert the bytes from hexadecimal to ASCII text, in order.',
  },
  Key: {
    question: 'What word is concealed by the keyed alphabet?',
    hint1: 'Unlike a Caesar wheel, the letter shifts change across the message.',
    hint2: 'This CSV entry has no separate key field. The organizer must supply the intended key or key rule.',
  },
  Keypad: {
    question: 'What word do these old mobile-phone keypad presses spell?',
    hint1: 'Think of multi-tap texting on a number keypad.',
    hint2: 'Repeated presses select a letter: 2 gives A/B/C, 3 gives D/E/F, and so on.',
  },
  Mirror: {
    question: 'What word appears in the mirror alphabet?',
    hint1: 'The first and last letters of the alphabet reflect each other.',
    hint2: 'Use Atbash: A↔Z, B↔Y, C↔X, continuing toward the middle.',
  },
  Noise: {
    question: 'Can you filter the static to recover the original word?',
    hint1: 'Some characters are deliberate interference, not part of the message.',
    hint2: 'Keep every other character, starting with the first.',
  },
  Radio: {
    question: 'What word is spelled by this radio transmission?',
    hint1: 'The words come from the radio phonetic alphabet.',
    hint2: 'Take the first letter of each code word, in order.',
  },
  'Raised Dots': {
    question: 'What word is written in raised-dot Braille?',
    hint1: 'Each cluster of dots is one Braille cell.',
    hint2: 'Read the Braille cells from left to right and translate each into a letter.',
  },
  Static: {
    question: 'What word is hidden in this Morse transmission?',
    hint1: 'Dots and dashes encode letters.',
    hint2: 'Translate each slash-separated Morse group into one letter.',
  },
  Weave: {
    question: 'What word appears when the two message strands are woven together?',
    hint1: 'The top and bottom rows are two halves of one message.',
    hint2: 'Take one letter from TOP, then one from BOTTOM, continuing left to right.',
  },
  Wheel: {
    question: 'Can you rotate the cipher wheel to reveal the word?',
    hint1: 'Every letter has been shifted by the same amount around the alphabet.',
    hint2: 'Try the same forward shift for every cipher letter; wrap around from Z to A when needed.',
  },
  Windows: {
    question: 'What word is spelled by the pattern of lit and dark windows?',
    hint1: 'Each row is an eight-bit binary number.',
    hint2: 'Read dark squares as 1 and light squares as 0, then convert each byte to its ASCII letter.',
  },
};

async function importPuzzles() {
  if (!fs.existsSync(sourcePath)) throw new Error(`Puzzle CSV not found at ${sourcePath}`);

  const records = parse(fs.readFileSync(sourcePath), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  const headers = Object.keys(records[0] || {});
  if (requiredColumns.some((column) => !headers.includes(column))) {
    throw new Error('Puzzle CSV is missing one or more required columns.');
  }

  const keys = new Set();
  const puzzles = records.map((record) => {
    const day = Number(record.Day);
    const participantNumber = Number(record['Participant #']);
    const ticketCode = record['Ticket code'].toUpperCase();
    if (!Number.isInteger(day) || day < 1 || day > 7
      || !Number.isInteger(participantNumber) || participantNumber < 1
      || !ticketCode || !record['Puzzle type'] || !record.Answer || !record['Cipher text']) {
      throw new Error(`Invalid puzzle row for day ${record.Day || '?'} and participant ${record['Participant #'] || '?'}.`);
    }
    const guide = puzzleGuides[record['Puzzle type']];
    if (!guide) throw new Error(`No question and hints are defined for puzzle type: ${record['Puzzle type']}.`);

    const key = `${day}:${ticketCode}`;
    if (keys.has(key)) throw new Error(`Duplicate ticket code for day ${day}.`);
    keys.add(key);

    return {
      day,
      date: record.Date,
      participantNumber,
      ticketCode,
      puzzleType: record['Puzzle type'],
      question: guide.question,
      hint1: guide.hint1,
      hint2: guide.hint2,
      answer: record.Answer,
      cipherText: record['Cipher text'],
    };
  });

  if (process.argv.includes('--check')) {
    console.log(`Validated ${puzzles.length} puzzles; no database changes made.`);
    return;
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');

  await mongoose.connect(process.env.MONGODB_URI);
  const operations = puzzles.map((puzzle) => ({
    updateOne: {
      filter: { day: puzzle.day, ticketCode: puzzle.ticketCode },
      update: { $set: puzzle },
      upsert: true,
    },
  }));
  const result = await Puzzle.bulkWrite(operations, { ordered: true });
  console.log(`Imported ${puzzles.length} puzzles (${result.upsertedCount} new, ${result.modifiedCount} updated).`);
}

importPuzzles()
  .catch((error) => {
    console.error('Puzzle import failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
