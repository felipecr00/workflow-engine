import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import * as api from '../api';
import { useStatus } from '../hooks/useStatus';
import { fmtDate } from '../utils';

export default function HomePage() {
  const { folderId } = useParams<{ folderId?: string }>();
  const { setStatus } = useStatus();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['browse', folderId ?? null],
    queryFn: async () => {
      const result = await api.browse(folderId);
      setStatus(
        `${result.folders.length} folder(s), ${result.projects.length} diagram(s)`,
        'success',
      );
      return result;
    },
  });

  const folders = data?.folders ?? [];
  const projects = data?.projects ?? [];
  const breadcrumbs = data?.breadcrumbs ?? [{ id: null, name: 'Home' }];
  const hasItems = folders.length > 0 || projects.length > 0;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['browse', folderId ?? null] });

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => api.createFolder(name, folderId),
    onSuccess: () => invalidate(),
    onError: (err) =>
      setStatus(`Failed: ${err instanceof Error ? err.message : err}`, 'error'),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => api.deleteFolder(id),
    onSuccess: () => invalidate(),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => invalidate(),
  });

  const createProjectMutation = useMutation({
    mutationFn: (name: string) => api.createProject(name, folderId),
    onSuccess: (project) => navigate(`/projects/${project.id}`),
    onError: (err) =>
      setStatus(`Failed: ${err instanceof Error ? err.message : err}`, 'error'),
  });

  const handleNewFolder = () => {
    const name = prompt('Folder name:');
    if (name) createFolderMutation.mutate(name);
  };

  const handleNewProject = () => {
    const name = prompt('Diagram name:');
    if (name) createProjectMutation.mutate(name);
  };

  const handleDeleteFolder = (id: string) => {
    if (confirm('Delete this folder and all its contents?')) {
      deleteFolderMutation.mutate(id);
    }
  };

  const handleDeleteProject = (id: string) => {
    if (confirm('Delete this diagram?')) {
      deleteProjectMutation.mutate(id);
    }
  };

  return (
    <div id="view-home" className="view active">
      <div id="home-toolbar">
        <div className="toolbar-group">
          <nav id="breadcrumbs" className="breadcrumbs">
            {breadcrumbs.map((b, i) => {
              const isLast = i === breadcrumbs.length - 1;
              if (isLast) {
                return <span key={b.id ?? 'root'} className="current">{b.name}</span>;
              }
              return (
                <span key={b.id ?? 'root'}>
                  <a
                    onClick={() =>
                      navigate(b.id ? `/folders/${b.id}` : '/')
                    }
                    style={{ cursor: 'pointer' }}
                  >
                    {b.name}
                  </a>
                  <span className="separator">&rsaquo;</span>
                </span>
              );
            })}
          </nav>
        </div>
        <div className="toolbar-group">
          <button onClick={handleNewFolder}>New Folder</button>
          <button className="btn-primary" onClick={handleNewProject}>New Diagram</button>
        </div>
      </div>
      <div id="home-content">
        {hasItems && (
          <table id="home-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th>Name</th>
                <th>Last Changed</th>
                <th style={{ width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {folders.map((folder) => (
                <tr key={folder.id}>
                  <td><span className="item-icon item-icon-folder">📁</span></td>
                  <td>
                    <span
                      className="home-item-name"
                      onClick={() => navigate(`/folders/${folder.id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      {folder.name}
                    </span>
                  </td>
                  <td>{fmtDate(folder.updated_at)}</td>
                  <td>
                    <button
                      className="btn-small btn-danger"
                      title="Delete folder"
                      onClick={() => handleDeleteFolder(folder.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {projects.map((project) => (
                <tr key={project.id}>
                  <td><span className="item-icon item-icon-project">⚙</span></td>
                  <td>
                    <span
                      className="home-item-name"
                      onClick={() => navigate(`/projects/${project.id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      {project.name}
                    </span>
                    {project.description && (
                      <div style={{ fontSize: 11, color: '#888' }}>
                        {project.description}
                      </div>
                    )}
                  </td>
                  <td>{fmtDate(project.updated_at)}</td>
                  <td>
                    <button
                      className="btn-small btn-danger"
                      title="Delete"
                      onClick={() => handleDeleteProject(project.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!hasItems && (
          <div id="home-empty" className="empty-state">
            <div style={{ marginBottom: 12 }}>No diagrams yet</div>
            <button className="btn-primary" onClick={handleNewProject}>
              Create your first diagram
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
