// Application languages and the Azure Speech locales used for recognition.
const speechLanguageCodeByDiagnosticLanguage = Object.freeze({
  en: "en-US",
  fil: "fil-PH",
});

class UnsupportedDiagnosticLanguageError extends Error {
  constructor(language) {
    super(`Unsupported diagnostic language: ${String(language)}`);
    this.name = "UnsupportedDiagnosticLanguageError";
  }
}

function isDiagnosticLanguage(language) {
  return Object.hasOwn(
    speechLanguageCodeByDiagnosticLanguage,
    language,
  );
}

function getSpeechLanguageCode(language) {
  if (!isDiagnosticLanguage(language)) {
    throw new UnsupportedDiagnosticLanguageError(language);
  }

  return speechLanguageCodeByDiagnosticLanguage[language];
}

module.exports = {
  getSpeechLanguageCode,
  isDiagnosticLanguage,
  UnsupportedDiagnosticLanguageError,
};
