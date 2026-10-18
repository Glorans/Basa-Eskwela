import type { Language } from "./types";
export const samples: Record<Language, { title: string; text: string }[]> = {
  en: [
    { title: "Bird and leaves", text: "The small bird rests on a branch. A gentle wind moves the leaves." },
    { title: "A quiet garden", text: "The garden is quiet after the rain. Tiny drops shine on the green leaves." },
  ],
  fil: [
    { title: "Ibon at mga dahon", text: "May maliit na ibon sa sanga. Marahang gumagalaw ang mga dahon sa hangin." },
    { title: "Tahimik na hardin", text: "Tahimik ang hardin matapos ang ulan. Kumikinang ang maliliit na patak sa mga dahon." },
  ],
};
