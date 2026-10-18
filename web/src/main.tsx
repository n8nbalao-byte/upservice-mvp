import { createRoot } from 'react-dom/client';
import App from './App';
import Instalar from './pages/Instalar';
import './lib/install';
import './styles.css';

createRoot(document.getElementById('root')!).render(location.pathname === '/instalar' ? <Instalar /> : <App />);
