import AdminCollectionEditor, { type M3EditorWorkspace } from '../components/AdminCollectionEditor';

export default function ModuleFormPage({ mode, workspace = 'admin' }: { mode: 'create' | 'edit' | 'detail'; workspace?: M3EditorWorkspace }) {
  return <AdminCollectionEditor mode={mode} workspace={workspace} />;
}
