import type { DiagnosticAssessment } from "../../types/diagnostic";

/**
 * One connected story read as a single passage: three sentences of 10, 20 and
 * 30 words (60 total, counted with normalizeReadingText). The passage is graded
 * as a whole; the sentences are never scored separately. Question order is
 * literal, literal, inferential x3, critical. The correct answer is always
 * choice "a" in the data; the questions page shuffles choice order for display.
 * Wording must be reviewed by the English/Filipino teacher before real use.
 */
export const englishDiagnosticAssessment = {
  "id": "grade5-en-passage-v3",
  "title": "Watering the School Garden",
  "gradeLevel": 5,
  "language": "en",
  "assessmentType": "initial",
  "sourceLabel": "ReadFlow-adapted diagnostic using Phil-IRI 2018 scoring (whole-passage grading)",
  "sourceUrl": "",
  "version": "3.0",
  "contentStatus": "active",
  "passage": {
    "language": "en",
    "title": "Watering the School Garden",
    "paragraphs": [
      "Mia walked to the school garden with her friend Ben.",
      "They hurried to water the tomato plants before the hot afternoon sun could dry the soil and harm the roots.",
      "Although the bucket was heavy and the path was long, Mia and Ben kept working together until every plant had enough water, and they felt proud of their careful teamwork."
    ]
  },
  "questions": [
    {
      "id": "en-question-1",
      "prompt": "Where did Mia and Ben go?",
      "choices": [
        {
          "id": "a",
          "label": "To the school garden"
        },
        {
          "id": "b",
          "label": "To the library"
        },
        {
          "id": "c",
          "label": "To the river"
        },
        {
          "id": "d",
          "label": "To the market"
        }
      ],
      "correctChoiceId": "a"
    },
    {
      "id": "en-question-2",
      "prompt": "What did they water?",
      "choices": [
        {
          "id": "a",
          "label": "The tomato plants"
        },
        {
          "id": "b",
          "label": "The flowers"
        },
        {
          "id": "c",
          "label": "The grass"
        },
        {
          "id": "d",
          "label": "The trees"
        }
      ],
      "correctChoiceId": "a"
    },
    {
      "id": "en-question-3",
      "prompt": "Why did they hurry?",
      "choices": [
        {
          "id": "a",
          "label": "To protect the plants from the hot sun"
        },
        {
          "id": "b",
          "label": "To play a game"
        },
        {
          "id": "c",
          "label": "To go home early"
        },
        {
          "id": "d",
          "label": "To eat lunch"
        }
      ],
      "correctChoiceId": "a"
    },
    {
      "id": "en-question-4",
      "prompt": "What does \"kept working together\" show about Mia and Ben?",
      "choices": [
        {
          "id": "a",
          "label": "They did not give up"
        },
        {
          "id": "b",
          "label": "They were tired"
        },
        {
          "id": "c",
          "label": "They were angry"
        },
        {
          "id": "d",
          "label": "They were lost"
        }
      ],
      "correctChoiceId": "a"
    },
    {
      "id": "en-question-5",
      "prompt": "Why did Mia and Ben feel proud?",
      "choices": [
        {
          "id": "a",
          "label": "They finished the hard work together"
        },
        {
          "id": "b",
          "label": "They won a prize"
        },
        {
          "id": "c",
          "label": "They went home early"
        },
        {
          "id": "d",
          "label": "They found money"
        }
      ],
      "correctChoiceId": "a"
    },
    {
      "id": "en-question-6",
      "prompt": "What is the best lesson of the story?",
      "choices": [
        {
          "id": "a",
          "label": "Teamwork makes hard work easier"
        },
        {
          "id": "b",
          "label": "Working alone is better"
        },
        {
          "id": "c",
          "label": "Plants do not need water"
        },
        {
          "id": "d",
          "label": "Heavy buckets are bad"
        }
      ],
      "correctChoiceId": "a"
    }
  ]
} as const satisfies DiagnosticAssessment<"en">;
