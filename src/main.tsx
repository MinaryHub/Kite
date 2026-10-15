import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';
import './styles/editor.css';

createRoot(document.getElementById('root')!).render(<App />);

if (import.meta.env.DEV) {
  import('./app/controller').then(({ app }) => ((window as any).__app = app));
}
