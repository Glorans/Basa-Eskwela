import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import M3PageHeader from "../components/M3PageHeader";
import UploadMaterialForm from "../components/UploadMaterialForm";
import { useM3Content } from "../context/M3ContentContext";
import type { M3Role } from "../types/content";
import { getM3WorkspaceRoot } from "../utils/workspaceRoot";

interface UploadMaterialPageProps {
  role: Extract<M3Role, "teacher" | "general_user">;
}

export default function UploadMaterialPage({ role }: UploadMaterialPageProps) {
  const navigate = useNavigate();
  const root = getM3WorkspaceRoot(role);
  const { refreshMaterials } = useM3Content();

  async function addToLibrary() {
    await refreshMaterials();
    navigate(`${root}/materials`);
  }

  return (
    <div className="m3-page-stack m3-page-stack--narrow">
      <Link className="m3-back-link" to={`${root}/materials`}>
        <ArrowLeft size={17} /> Back to My Materials
      </Link>
      <M3PageHeader
        eyebrow={role === "teacher" ? "Teacher workspace" : "Personal workspace"}
        title="Upload Reading Material"
        description="Prepare a PDF, DOCX, JPG, or PNG source for a future reading activity."
      />
      <UploadMaterialForm
        onCancel={() => navigate(`${root}/materials`)}
        onAddToLibrary={addToLibrary}
      />
    </div>
  );
}
