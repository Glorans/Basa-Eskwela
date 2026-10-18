const googleSpeechLanguageCodeByDiagnosticLanguage = Object.freeze({
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
    googleSpeechLanguageCodeByDiagnosticLanguage,
    language,
  );
}

function getGoogleSpeechLanguageCode(language) {
  if (!isDiagnosticLanguage(language)) {
    throw new UnsupportedDiagnosticLanguageError(language);
  }

  return googleSpeechLanguageCodeByDiagnosticLanguage[language];
}

module.exports = {
  getGoogleSpeechLanguageCode,
  isDiagnosticLanguage,
  UnsupportedDiagnosticLanguageError,
};
