"use strict";
function tokenize(text) {
  return text.normalize("NFC").toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
}
function compareTranscript(expected, transcript, completeness) {
  // No accuracy percentage: intended text is not a human-verified spoken reference.
  if (completeness !== "complete") return { available: false, reason: "Incomplete or empty recognition: agreement is not calculated.", discrepancies: [] };
  const a = tokenize(expected), b = tokenize(transcript);
  const grid = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = 0; i <= a.length; i++) grid[i][0] = i;
  for (let j = 0; j <= b.length; j++) grid[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    grid[i][j] = Math.min(grid[i - 1][j] + 1, grid[i][j - 1] + 1, grid[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
  const discrepancies = [];
  let i = a.length, j = b.length;
  while (i || j) {
    if (i && j && grid[i][j] === grid[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1])) {
      if (a[i - 1] !== b[j - 1]) discrepancies.push({ kind: "substitution", expected: a[i - 1], recognized: b[j - 1], expectedIndex: i - 1 });
      i--; j--;
    } else if (i && grid[i][j] === grid[i - 1][j] + 1) {
      discrepancies.push({ kind: "omission", expected: a[i - 1], recognized: "", expectedIndex: i - 1 }); i--;
    } else { discrepancies.push({ kind: "insertion", expected: "", recognized: b[j - 1], expectedIndex: i }); j--; }
  }
  return { available: true, normalization: "NFC, lowercase, punctuation removed; apostrophes retained", discrepancies: discrepancies.reverse(), expectedWords: a.length, recognizedWords: b.length };
}
module.exports = { compareTranscript, tokenize };
