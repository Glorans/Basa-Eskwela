import { diagnosticCopy } from "../utils/diagnosticCopy";
import { getNextDiagnosticLanguage } from "../data/diagnosticData";
import type { DiagnosticLanguage } from "../types/diagnostic";
import { useNavigate, useOutletContext } from "react-router-dom";
import mascot from "../../../assets/mascot.png";
import DiagnosticLayout from "../components/DiagnosticLayout";
import "./DiagnosticStartPage.css";

export default function DiagnosticStartPage() {
  const navigate = useNavigate();
  const completed = useOutletContext<DiagnosticLanguage[]>();

  const language = getNextDiagnosticLanguage(completed ?? []) ?? "en";
  const t = (text: string) => diagnosticCopy(language, text);

  function startAssessment() {
    const language = getNextDiagnosticLanguage(completed ?? []);
    if (language) navigate(`/diagnostic/${language}/reading`);
  }

  return (
    <DiagnosticLayout
      className="diagnostic-start-panel"
      labelledBy="diagnostic-start-title"
    >
      <img
        className="diagnostic-start-mascot"
        src={mascot}
        alt="Basa Eskwela mascot"
      />

      <div className="diagnostic-start-content">
        <h1 id="diagnostic-start-title">
          {language === "fil" ? "Alamin Natin ang Antas Mo sa Pagbasa!" : <>Let&rsquo;s Find Your Reading Level!</>}
        </h1>

        <p className="diagnostic-start-description">
          {language === "fil" ? "Basahin nang malakas ang tatlong pangungusap at sagutin ang anim na tanong sa bawat wika." : "Read three sentences aloud and answer six questions in each language."}
          <br />
          {language === "fil" ? "Gawin ang iyong makakaya at magsaya!" : "Just do your best and have fun!"}
        </p>

        <button
          className="diagnostic-primary-button"
          type="button"
          onClick={startAssessment}
        >{t("Start Assessment")}</button>

        <p className="diagnostic-start-note">{t("It only takes a few minutes.")}</p>
      </div>
    </DiagnosticLayout>
  );
}
