import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getAssignedReadingProgress } from "../../module5/services/oralReadingService";
import { assignedReadingTarget } from "../../module5/services/assignedReadingNavigation";
import { getStudentAssignedReadingMaterial } from "../services/classroomService";
import { activityLanguageState, getActivityText } from "../../../pages/reading-activity/activityLanguage";

/** Compatibility entry for bookmarks: resolve the saved assessment, without writing M4 status. */
export default function StudentReadingActivityPage() {
  const { roomId, materialId } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [material, setMaterial] = useState<{ id: string; language: string }>();
  const ui = getActivityText(material?.id === materialId ? material?.language : undefined);
  useEffect(() => {
    let active = true;
    if (!roomId || !materialId) { setError("Reading activity not found."); return; }
    setError("");
    void Promise.all([getAssignedReadingProgress(roomId), getStudentAssignedReadingMaterial(materialId).catch(() => null)]).then(([progress, source]) => {
      if (active && source) setMaterial(source);
      const activity = progress.find(item => item.materialId === materialId);
      if (!activity) throw new Error("This reading activity is not assigned to you.");
      if (active) navigate(assignedReadingTarget(activity), { replace: true, state: activityLanguageState(source?.language) });
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Unable to open activity."); });
    return () => { active = false; };
  }, [roomId, materialId, navigate]);
  return <main className="m6-page" lang={ui.language}>
    <p role={error ? "alert" : "status"}>{error ? ui.message(error, "Unable to open activity.") : ui.t("Opening your reading activity...")}</p>
    {error && <button onClick={() => window.location.reload()}>{ui.t("Retry")}</button>}
    <button onClick={() => navigate(`/dashboard/learning-rooms/${roomId}`)}>{ui.t("Back to Learning Room")}</button>
  </main>;
}
