import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';
import './styles/editor.css';
import 'katex/dist/katex.min.css';

createRoot(document.getElementById('root')!).render(<App />);

if (import.meta.env.DEV) {
  import('./app/controller').then(({ app }) => ((window as any).__app = app));
  import('./app/mcpHandlers').then(({ callMcpTool }) => ((window as any).__mcpTool = callMcpTool));
  import('./collab/session').then((m) => ((window as any).__collab = m));
  import('./app/commands').then((m) => ((window as any).__commands = m));
}
