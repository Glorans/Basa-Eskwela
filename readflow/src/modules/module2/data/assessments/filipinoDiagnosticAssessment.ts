import type { DiagnosticAssessment } from "../../types/diagnostic";

/**
 * One connected story read as a single passage: three sentences of 10, 20 and
 * 30 words (60 total, counted with normalizeReadingText). The passage is graded
 * as a whole; the sentences are never scored separately. Question order is
 * literal, literal, inferential x3, critical. The correct answer is always
 * choice "a" in the data; the questions page shuffles choice order for display.
 * Wording must be reviewed by the English/Filipino teacher before real use.
 */
export const filipinoDiagnosticAssessment = {
  "id": "grade5-fil-passage-v3",
  "title": "Si Lito at ang Mais",
  "gradeLevel": 5,
  "language": "fil",
  "assessmentType": "initial",
  "sourceLabel": "ReadFlow-adapted diagnostic using Phil-IRI 2018 scoring (whole-passage grading)",
  "sourceUrl": "",
  "version": "3.0",
  "contentStatus": "active",
  "passage": {
    "language": "fil",
    "title": "Si Lito at ang Mais",
    "paragraphs": [
      "Maagang nagtungo si Lito sa bukid kasama ang lola niya.",
      "Magkasama nilang inani ang mga mais at agad inilagay ang mga ito sa basket bago bumuhos ang malakas na ulan.",
      "Kahit basa na ang kanilang damit at madulas ang daan pauwi, maingat na binuhat ni Lito ang mabigat na basket at hindi niya iniwan ang pagod na pagod niyang lola."
    ]
  },
  "questions": [
    {
      "id": "fil-question-1",
      "prompt": "Saan nagtungo si Lito kasama ang lola niya?",
      "choices": [
        {
          "id": "a",
          "label": "Sa bukid"
        },
        {
          "id": "b",
          "label": "Sa palengke"
        },
        {
          "id": "c",
          "label": "Sa simbahan"
        },
        {
          "id": "d",
          "label": "Sa paaralan"
        }
      ],
      "correctChoiceId": "a"
    },
    {
      "id": "fil-question-2",
      "prompt": "Ano ang inani nila?",
      "choices": [
        {
          "id": "a",
          "label": "Ang mga mais"
        },
        {
          "id": "b",
          "label": "Ang mga kamatis"
        },
        {
          "id": "c",
          "label": "Ang palay"
        },
        {
          "id": "d",
          "label": "Ang mga saging"
        }
      ],
      "correctChoiceId": "a"
    },
    {
      "id": "fil-question-3",
      "prompt": "Bakit agad nilang inilagay ang mga mais sa basket?",
      "choices": [
        {
          "id": "a",
          "label": "Para hindi mabasa ng ulan ang mga mais"
        },
        {
          "id": "b",
          "label": "Para maibenta agad sa palengke"
        },
        {
          "id": "c",
          "label": "Para makapaglaro si Lito"
        },
        {
          "id": "d",
          "label": "Para ipakain sa mga manok"
        }
      ],
      "correctChoiceId": "a"
    },
    {
      "id": "fil-question-4",
      "prompt": "Ano ang ipinapakita ng maingat na pagbuhat ni Lito sa mabigat na basket?",
      "choices": [
        {
          "id": "a",
          "label": "Marunong siyang tumulong at magmalasakit"
        },
        {
          "id": "b",
          "label": "Gusto niyang magpasikat"
        },
        {
          "id": "c",
          "label": "Ayaw niyang mabasa ng ulan"
        },
        {
          "id": "d",
          "label": "Nagmamadali siyang maglaro"
        }
      ],
      "correctChoiceId": "a"
    },
    {
      "id": "fil-question-5",
      "prompt": "Bakit pagod na pagod ang lola ni Lito?",
      "choices": [
        {
          "id": "a",
          "label": "Mabigat ang gawain sa bukid at matanda na siya"
        },
        {
          "id": "b",
          "label": "Natulog siya buong araw"
        },
        {
          "id": "c",
          "label": "Naglaro siya sa ulan"
        },
        {
          "id": "d",
          "label": "Hindi siya nagtrabaho"
        }
      ],
      "correctChoiceId": "a"
    },
    {
      "id": "fil-question-6",
      "prompt": "Tama ba na hindi iniwan ni Lito ang kaniyang lola?",
      "choices": [
        {
          "id": "a",
          "label": "Tama, dahil dapat alagaan ang kapamilyang nahihirapan"
        },
        {
          "id": "b",
          "label": "Mali, dahil dapat nauna siyang umuwi"
        },
        {
          "id": "c",
          "label": "Mali, dahil mas mahalaga ang basket kaysa sa lola"
        },
        {
          "id": "d",
          "label": "Walang pagkakaiba kung iwan niya ang lola"
        }
      ],
      "correctChoiceId": "a"
    }
  ]
} as const satisfies DiagnosticAssessment<"fil">;
