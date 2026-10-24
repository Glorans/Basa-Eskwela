import { useCallback, useState, type MouseEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { confirmReadFlow } from "../../../components/ReadFlowDialog";
import M3PageHeader from "../components/M3PageHeader";
import UploadMaterialForm from "../components/UploadMaterialForm";
import { useM3Content } from "../context/M3ContentContext";
import type { M3Role } from "../types/content";
import { getM3WorkspaceRoot } from "../utils/workspaceRoot";

interface UploadMaterialPageProps {
  role: Extract<M3Role, "teacher" | "general_user">;
}

const UNSAVED_MESSAGE =
  "Your extracted text has not been saved. Leave this page and discard it?";

export default function UploadMaterialPage({ role }: UploadMaterialPageProps) {
  const navigate = useNavigate();
  const root = getM3WorkspaceRoot(role);
  const materialsPath = `${root}/materials`;
  const { refreshMaterials } = useM3Content();
  const [unsaved, setUnsaved] = useState(false);
  const handleUnsavedChange = useCallback((value: boolean) => setUnsaved(value), []);

  // The material list is reloaded only after the database save succeeded.
  async function materialSaved() {
    await refreshMaterials();
  }

  async function leave() {
    if (unsaved && !(await confirmReadFlow(UNSAVED_MESSAGE))) return;
    navigate(materialsPath);
  }

  function handleBackLink(event: MouseEvent<HTMLAnchorElement>) {
    if (!unsaved) return;
    event.preventDefault();
    void leave();
  }

  return (
    <div className="m3-page-stack m3-page-stack--narrow">
      <Link className="m3-back-link" to={materialsPath} onClick={handleBackLink}>
        <ArrowLeft size={17} /> Back to My Materials
      </Link>
      <M3PageHeader
        eyebrow={role === "teacher" ? "Teacher workspace" : "Personal workspace"}
        title="Upload Reading Material"
        description="Prepare a PDF, DOCX, JPG, or PNG source for a future reading activity."
      />
      <UploadMaterialForm
        onCancel={() => void leave()}
        onSaved={materialSaved}
        onViewMaterials={() => navigate(materialsPath)}
        onUnsavedChange={handleUnsavedChange}
      />
    </div>
  );
}
