// Opt-in live Gemini smoke test. Uses only synthetic text and in-memory persistence.
// Run from repository root: node server/scripts/checkM3QuestionDiversity.js
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const { generateComprehensionQuestions } = require('../services/questionGenerationService');
const { generateMaterialQuestionSet, getMaterialQuestionSet, listMaterialQuestionSets } = require('../services/materialQuestionSetService');
const { createDatabase, dependencies, material, requester, MATERIAL_A, TEACHER_A } = require('../tests/fixtures/materialDatabase');
const source = `The Riverside School Project
In June, Ms. Reyes asked her Grade 5 class to improve an unused corner of the school. The corner received morning sunlight but was shaded in the afternoon. The children measured it with a borrowed tape measure and drew a plan on reused paper. They chose a vegetable garden because the school kitchen needed fresh ingredients for soup. The principal allowed the project only if the children kept the walkway clear for younger pupils.
Lina interviewed the cook, who requested pechay and tomatoes. Ben wanted roses because they looked beautiful, but he agreed to reserve only a small border for flowers after hearing the cook's needs. The class voted to plant vegetables in the center and flowers along the fence. They compared prices at two seed shops and chose the shop that offered healthy local seeds in paper packets. Their budget came from a Saturday sale of bookmarks they had made from old magazines. They recorded every purchase in a notebook so classmates could see how the money was used.
Before planting, the children found broken glass in the soil. They stopped working and called the school caretaker, who removed it with protective gloves. The class then loosened the soil with small tools. They mixed in compost made from dry leaves and fruit peels, but excluded plastic wrappers. Two parents showed them how to leave enough space between seedlings. Each group labeled its row with a reused wooden stick so everyone could identify the young plants.
During the first week, plants near the wall grew slowly. Omar noticed that rainwater collected there. He suggested making shallow drainage channels instead of adding more fertilizer. After the channels were dug, the soil stopped staying muddy. The class kept a weekly chart of plant height to compare the improved row with the others. They understood that one successful week was not enough to prove every plant would recover.
Water was limited during a dry spell in July. The class placed covered containers beneath a roof drain to collect rainwater. They watered early in the morning to reduce evaporation and covered bare soil with dry leaves to keep it moist. One container developed a crack. Rather than throw it away, Ana used it as a planter for herbs. All containers holding water were covered to prevent mosquitoes from breeding. The children washed their hands after working.
The class assigned garden duties in pairs. When Nico missed his turn because he was caring for his younger sister, his partner complained. Ms. Reyes invited both children to explain what had happened. The class decided to post a duty-swap sheet so children could arrange help in advance. Nico thanked his partner and took an extra turn the following week. The students learned that fair rules could consider different responsibilities at home.
One morning, caterpillars appeared on the pechay. Some pupils suggested spraying an unknown chemical from a shed. Instead, the teacher asked a local farmer for advice. The farmer showed them how to remove the caterpillars by hand while wearing gloves and protect the rows with a fine net. The class checked the leaves each morning. They left harmless insects alone after learning that not every insect damaged vegetables.
In August, a strong storm bent several tomato stems. The children tied the stems gently to bamboo supports. A few plants were too damaged to save, so the class planted new seedlings in those spaces. They kept notes about which supports had survived. For the next planting season, they planned to install supports before storms arrived instead of waiting for damage.
At harvest time, each group weighed its vegetables using the same scale. Half of the harvest went to the school kitchen. A quarter was shared with families who had helped, and the rest was sold to buy seeds for the next season. They donated extra herbs to a neighbor who prepared meals for older residents. The cook invited the class to taste soup made with their pechay and thanked them for washing the vegetables carefully.
For the school exhibit, the class displayed photographs, spending records, and growth charts. They included failed experiments as well as successes. Ben explained that reporting only healthy plants would give visitors a misleading picture of their work. Lina suggested asking next year's class to improve their plan rather than copy it exactly. The principal approved a second garden bed after checking that the first project had respected the walkway and its budget.
The garden project also led to a school magazine. During a reporting lesson, Maya received a message claiming that the town bridge would close the next morning. Instead of publishing it at once, she called the town office. The office said only one lane would close for repairs and pedestrians could still cross. Maya corrected the headline and included the date of the announcement. She learned that a dramatic headline could cause unnecessary worry if it left out important information. Her classmate Luis asked the bridge workers for permission before taking their photographs. One worker declined, so Luis photographed only the tools and signs. The editor removed a child's home address from an interview because readers did not need that private detail to understand the story.
Another magazine team investigated the library. They counted which shelves were hard for younger pupils to reach. Instead of buying an expensive ladder, they moved popular picture books to the lowest shelves and tested the arrangement with Grade 1 visitors. A visitor who used a wheelchair could now reach the books without help. The librarian kept a quiet reading area apart from the storytelling corner so different activities could happen together. A missing book was eventually found behind a shelf. The class apologized to the pupil they had blamed without evidence. They replaced the accusation with a simple checkout record that tracked borrowed titles, not rumors.
For a third report, the class visited a coastal village. A fisher explained that mangrove roots sheltered small fish and slowed waves. Some residents wanted to remove mangroves to make more parking spaces, while others proposed using an empty lot farther from the shore. The pupils drew both plans and listed how each would affect residents, visitors, and wildlife. They did not assume one interview represented every family's opinion. At the beach, they saw a turtle nest marked by conservation volunteers. They watched from a distance and turned off their flashlights because bright light could confuse newly hatched turtles. The volunteers collected litter but left shells and driftwood in place as part of the shore habitat.`;
async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY unavailable; no live test run.');
  const db = createDatabase({ uploaded_materials: [{ ...material(MATERIAL_A, TEACHER_A), content_text: source }] });
  db.rpc = async (_, args) => {
    assert.equal(args.operation, 'create');
    const id = randomUUID(), n = db.tables.material_question_sets.length + 1;
    db.tables.material_question_sets.push({ id, material_id: MATERIAL_A, name: `Question Set ${n}`, sequence_number: n, revision: 1 });
    args.bank.forEach((q, i) => {
      db.tables.comprehension_questions.push({ id: q.id, material_id: MATERIAL_A, question_set_id: id, question_type: q.type,
        question_text: q.questionText, options: q.options, scaffolding_hint: q.scaffoldingHint, display_order: i + 1, review_status: 'generated' });
      db.tables.comprehension_question_answers.push({ question_id: q.id, correct_answer: q.correctAnswer });
    });
    return { data: id, error: null };
  };
  const client = new (require('@google/genai').GoogleGenAI)({ apiKey: process.env.GEMINI_API_KEY });
  let nextRequestAt = 0;
  const teacher = requester(TEACHER_A, 'teacher'), saved = [];
  for (let n = 0; n < 3; n++) {
    const createSet = () => generateMaterialQuestionSet(teacher, MATERIAL_A, null, null, async input => {
      assert.equal(input.language, 'en');
      assert.equal(input.previousQuestions.length, n * 6);
      return generateComprehensionQuestions(input, { generateContent: async request => {
        const startAt = Math.max(Date.now(), nextRequestAt);
        nextRequestAt = startAt + 6_000; // Keep the opt-in smoke test below common per-minute quotas.
        await new Promise(resolve => setTimeout(resolve, startAt - Date.now()));
        const response = await client.models.generateContent(request).catch(error => {
          console.error('Live provider status:', Number(error.status) || 'unavailable');
          throw error;
        });
        if (request.contents.startsWith('Compare the candidate')) { const check = JSON.parse(response.text); if (check.repeatsPriorIdea) console.log('Focused overlap:', check.reasoning); }
        if (!request.contents.startsWith('Compare the candidate')) fs.writeFileSync(path.join(os.tmpdir(), `readflow-m3-live-${n + 1}-${request.contents.includes('Independently audit') ? 'audit' : 'candidate'}.json`), response.text ?? '');
        return response;
      } });
    }, dependencies(db));
    let set;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const before = structuredClone(db.tables);
      try { set = await createSet(); break; }
      catch (error) {
        assert.deepEqual(db.tables, before);
        console.log(`Rejected attempt ${attempt} for set ${n + 1}: ${error.code}; existing rows unchanged`);
        if (attempt === 3 || !['INSUFFICIENT_QUESTION_DIVERSITY', 'GEMINI_REQUEST_FAILED', 'GEMINI_TIMEOUT', 'INVALID_GEMINI_RESPONSE'].includes(error.code)) throw error;
      }
    }
    saved.push(set);
    assert.deepEqual(set.counts, { literal: 2, inferential: 2, critical: 2 });
    for (const old of saved) assert.deepEqual(await getMaterialQuestionSet(teacher, MATERIAL_A, old.id, dependencies(db)), old);
    console.log(`PASS: live Gemini set ${n + 1}, English, 2/2/2, exclusions=${n * 6}, earlier sets unchanged`);
  }
  assert.equal(new Set(saved.flatMap(s => s.questions.map(q => q.id))).size, 18);
  assert.equal((await listMaterialQuestionSets(teacher, MATERIAL_A, dependencies(db))).length, 3);
  const report = path.join(os.tmpdir(), 'readflow-m3-live-diversity.json');
  fs.writeFileSync(report, JSON.stringify({ source, sets: saved, persistence: 'in-memory fixture; no production database' }, null, 2));
  console.log('REPORT:', report);
}
main().catch(error => { console.error(error.code || error.name, error.message); process.exitCode = 1; });
