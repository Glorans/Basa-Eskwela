# M8 F2–F5 release notes

Local work, not deployed. These proposals need M8 F1 installed first and stop themselves otherwise.

## Release order

1. M8 F1 (backend, then frontend, then its migration).
2. F2–F5 frontend. It works before the new migrations by falling back to the existing functions.
3. `m8_f2_f5_v1_VERIFY_READONLY.sql`, then `m8_f2_badges_streaks_v1`, `m8_f3_achievements_v1` and `m8_f4_rankings_v1`.

The F4 migration removes client access to the three older leaderboard functions, so the frontend must be live first. A tab left open from before then shows a leaderboard error until it is refreshed.

Rolling back F4 keeps those three functions closed, because they return user IDs, reading levels and nicknames. Leaderboard pages then show an error until F4 is applied again.

## Provisional rules, pending adviser approval

| Achievement | Counts | Bronze | Silver | Gold |
|---|---|---|---|---|
| Accurate Reader | Distinct English readings at 90% or above | 3 | 10 | 25 |
| Comprehension Star | Distinct assessments at 80% or above, English and Filipino | 3 | 10 | 25 |

Only the first reading or assessment of a text counts, so repeats cannot raise either count. There is no Filipino reading-accuracy achievement until Filipino scoring validation is approved.

## Known limitations

- **Graduate:** the rule is every published module, excluding the Trash. Classroom Students can only open modules assigned to them, so they may not have access to every published module and may be unable to earn this badge. Changing the rule needs a separate team decision.
- **Level Up:** Frustration-level learners cannot earn it without reassessment, which belongs to M8 F6 and is not part of this release.
- **Bookworm during the English pilot:** an English module counts per passage; a Filipino module on the fixed reward counts once.
- **Rankings during the pilot:** English and Filipino rank separately because they earn XP differently. Older fixed English XP still counts in English rankings until it ages out of the weekly period.
- **Reading streaks:** only verified readings and rewarded completions add a reading day. The daily login never does.

## Ranking privacy

Rankings return an opaque ID, a pseudonym, XP and whether the row is the viewer's own. They return no name, nickname, email, profile ID or reading level. Independent Learner pseudonyms stay the same across a ranking period and change when a new week starts. Classroom pseudonyms stay the same within a classroom.
