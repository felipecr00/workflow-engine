import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { StatusContext, useStatusProvider } from './hooks/useStatus';
import Layout from './components/Layout';
import IncidentsPage from './pages/IncidentsPage';
import FormsListPage from './pages/FormsListPage';
import InstancesPage from './pages/InstancesPage';
import HomePage from './pages/HomePage';
import ModelerPage from './pages/ModelerPage';
import FormEditorPage from './pages/FormEditorPage';
import InstanceDetailPage from './pages/InstanceDetailPage';
import TasksPage from './pages/TasksPage';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css';
import '@bpmn-io/form-js/dist/assets/form-js.css';
import '@bpmn-io/form-js/dist/assets/form-js-editor.css';

import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <App />,
      children: [
        { index: true, element: <HomePage /> },
        { path: 'folders/:folderId', element: <HomePage /> },
        { path: 'projects/:projectId', element: <ModelerPage /> },
        { path: 'instances', element: <InstancesPage /> },
        { path: 'instances/:instanceId', element: <InstanceDetailPage /> },
        { path: 'tasks', element: <TasksPage /> },
        { path: 'tasks/:taskId', element: <TasksPage /> },
        { path: 'user-tasks', element: <Navigate to="/tasks" replace /> },
        { path: 'forms', element: <FormsListPage /> },
        { path: 'forms/new', element: <FormEditorPage /> },
        { path: 'forms/:formKey', element: <FormEditorPage /> },
        { path: 'incidents', element: <IncidentsPage /> },
      ],
    },
  ],
  { basename: '/modeler' },
);

function App() {
  const status = useStatusProvider();
  return (
    <StatusContext.Provider value={status}>
      <Layout />
    </StatusContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
