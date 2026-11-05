# M7 label review: Reading Accuracy vs Pronunciation Accuracy

Status: **resolved in the working tree (2026-11-06).** The changes are not on the hosted site until M7 is released.

## The rule
M5 saves two different measurements:

| Measurement | Where it is stored | What it measures |
|---|---|---|
| **Reading Accuracy** | `oral_reading_attempts.pronunciation_accuracy`. The column name is historical and misleading. | Transcript-based: how closely the words heard matched the story. |
| **Pronunciation Accuracy** | `oral_reading_pronunciation_checks.accuracy` | The English pronunciation check (0-100). |

M7 reads only the first value, so every M7 figure is **Reading Accuracy**. Internal names such as `averagePronunciationAccuracy` and the API field `pronunciationAccuracy` are unchanged, because renaming them would touch saved report data.

## What was corrected
- `TeacherAnalyticsPage.tsx`: the page description and both card descriptions now say reading accuracy, transcript-based.
- `M7Pages.tsx`: the "Detected errors" column is now "Words different from the story", and stored percentages are rounded to the nearest whole number for learners.
- Weekly reports and PDFs label the value "Reading Accuracy". A test checks that the PDF never says "Pronunciation".
