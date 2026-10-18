import AdminCollectionEditor from '../components/AdminCollectionEditor';

export default function ModuleFormPage({ mode }: { mode: 'create' | 'edit' }) {
  return <AdminCollectionEditor mode={mode} />;
}
